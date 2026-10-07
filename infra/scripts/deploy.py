"""Explicit, locally testable deployment phases. No Azure command without --execute."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
PHASES = ("plan", "foundation", "build-images", "application")
SECRET_URI = re.compile(
    r"https://[a-z0-9-]{3,24}\.vault\.azure\.net/secrets/[A-Za-z0-9-]{1,127}/[a-f0-9]{32}"
)
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")


class DeploymentError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise DeploymentError(message)


def required(env, name):
    value = env.get(name, "")
    require(bool(value.strip()) and value == value.strip(), f"{name} is required without surrounding whitespace.")
    require("\n" not in value and "\r" not in value, f"{name} must be a single line.")
    return value


def required_uuid(env, name):
    value = required(env, name)
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise DeploymentError(f"{name} must be a UUID.") from error
    require(str(parsed) == value.lower() and parsed.int > 1, f"{name} must be a real, canonical UUID, not a CI fixture.")
    return value


def integer(env, name, default, minimum, maximum):
    value = env.get(name, str(default))
    require(bool(re.fullmatch(r"[0-9]+", value)), f"{name} must be an integer.")
    number = int(value)
    require(minimum <= number <= maximum, f"{name} must be between {minimum} and {maximum}.")
    return number


def validate_image(image, repository, registry=None):
    match = re.fullmatch(
        rf"([a-z0-9]{{5,50}}\.azurecr\.io)/{re.escape(repository)}@(sha256:[a-f0-9]{{64}})",
        image,
    )
    require(match is not None, f"{repository} requires a full ACR repository@sha256:digest reference, never a tag.")
    if registry is not None:
        require(match.group(1) == registry, f"{repository} must be in the recorded foundation registry.")
    return image


def preflight(phase, environment, apply, env):
    require(phase in PHASES and environment in ("dev", "prod"), "Invalid phase or environment.")
    if phase == "plan":
        require(not apply, "The local plan cannot apply changes.")
        return
    require(env.get("AZURE_DEPLOY_ENABLED") == "true", "AZURE_DEPLOY_ENABLED must explicitly equal true, including manual runs.")
    require(
        env.get("AZURE_ENVIRONMENT_APPROVAL_CONFIGURED") == "true",
        "Configure protected GitHub environment approval first; acknowledge with AZURE_ENVIRONMENT_APPROVAL_CONFIGURED=true.",
    )
    if env.get("GITHUB_ACTIONS") == "true":
        require(
            env.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and env.get("GITHUB_REF") == "refs/heads/main",
            "Azure phases are manual-only on main; pushes and other refs cannot deploy.",
        )
    required_uuid(env, "AZURE_SUBSCRIPTION_ID")
    required_uuid(env, "AZURE_TENANT_ID")
    required_uuid(env, "AZURE_CLIENT_ID")
    require(
        bool(re.fullmatch(r"[A-Za-z0-9_().-]{1,90}", required(env, "AZURE_RESOURCE_GROUP")))
        and not env["AZURE_RESOURCE_GROUP"].endswith("."),
        "AZURE_RESOURCE_GROUP must be an existing, explicitly selected resource group.",
    )
    if apply:
        for gate in ("AZURE_COST_APPROVED", "AZURE_FOUNDATION_APPROVED"):
            require(env.get(gate) == "true", f"{gate}=true is required before any paid mutation; it is not evidence of readiness.")

    if phase == "foundation":
        require(
            bool(re.fullmatch(r"[a-z][a-z0-9]{1,30}", required(env, "AZURE_LOCATION"))),
            "AZURE_LOCATION must name the owner-approved region, not a CI fixture.",
        )
        require(
            bool(re.fullmatch(r"[a-z][a-z0-9]{2,9}", env.get("AZURE_NAME_PREFIX", "calledit"))),
            "AZURE_NAME_PREFIX must be 3-10 lowercase alphanumeric characters, starting with a letter.",
        )
        required_uuid(env, "SQL_ENTRA_ADMIN_OBJECT_ID")
        required(env, "SQL_ENTRA_ADMIN_LOGIN")
        require(
            env.get("SQL_ENTRA_ADMIN_PRINCIPAL_TYPE", "Group") in ("Group", "User", "Application"),
            "SQL_ENTRA_ADMIN_PRINCIPAL_TYPE must be Group, User or Application.",
        )
        try:
            addresses = json.loads(env.get("SQL_ALLOWED_CLIENT_IPS", "[]"))
        except json.JSONDecodeError as error:
            raise DeploymentError("SQL_ALLOWED_CLIENT_IPS must be a JSON array of individual public IPv4 addresses.") from error
        require(isinstance(addresses, list) and len(addresses) <= 32, "SQL_ALLOWED_CLIENT_IPS must be an array of at most 32 addresses.")
        for address in addresses:
            try:
                parsed = ipaddress.IPv4Address(address) if isinstance(address, str) else None
            except ipaddress.AddressValueError as error:
                raise DeploymentError("SQL_ALLOWED_CLIENT_IPS contains an invalid IPv4 address; ranges/CIDRs are not accepted.") from error
            require(parsed is not None and parsed.is_global, "SQL firewall entries must be individual public IPv4 addresses, never 0.0.0.0.")
        require(len(addresses) == len(set(addresses)), "SQL_ALLOWED_CLIENT_IPS must not contain duplicates.")

    if phase == "build-images":
        require(
            bool(re.fullmatch(r"[a-f0-9]{40}-[0-9]+-[0-9]+", required(env, "IMAGE_TAG"))),
            "IMAGE_TAG must be the full commit SHA-run ID-run attempt; no latest tag is built.",
        )

    if phase == "application":
        require(
            bool(re.fullmatch(r"r[0-9]{1,20}-[0-9]{1,6}", required(env, "APPLICATION_REVISION_SUFFIX"))),
            "APPLICATION_REVISION_SUFFIX must be a new r<run-ID>-<attempt> value, including on rollback/secret rotation.",
        )
        validate_image(required(env, "API_IMAGE"), "called-it-api")
        validate_image(required(env, "WORKERS_IMAGE"), "called-it-workers")
        for name in ("AUTH_SIGNING_KEY_SECRET_URI", "CONTACTS_PEPPER_SECRET_URI"):
            require(SECRET_URI.fullmatch(required(env, name)) is not None, f"{name} must be a versioned Key Vault secret URI.")
        for name in ("SOCIAL_AUTH_APPLE_AUDIENCE", "SOCIAL_AUTH_GOOGLE_AUDIENCE"):
            required(env, name)
        minimum = integer(env, "API_MIN_REPLICAS", 1, 1, 3)
        maximum = integer(env, "API_MAX_REPLICAS", 2, 1, 3)
        require(minimum <= maximum, "API_MIN_REPLICAS cannot exceed API_MAX_REPLICAS.")
        integer(env, "API_HTTP_CONCURRENT_REQUESTS", 20, 1, 100)
        provider = env.get("PUSH_PROVIDER", "Disabled")
        require(provider in ("Disabled", "NotificationHubs"), "PUSH_PROVIDER must be Disabled or NotificationHubs.")
        if provider == "NotificationHubs":
            require(
                bool(re.fullmatch(r"[A-Za-z0-9_.-]{1,260}", required(env, "NOTIFICATION_HUB_NAME"))),
                "NOTIFICATION_HUB_NAME is invalid.",
            )
            require(
                SECRET_URI.fullmatch(required(env, "NOTIFICATION_HUB_CONNECTION_SECRET_URI")) is not None,
                "NOTIFICATION_HUB_CONNECTION_SECRET_URI must be a versioned Key Vault secret URI.",
            )
            if apply:
                require(env.get("PUSH_CONFIGURATION_APPROVED") == "true", "PUSH_CONFIGURATION_APPROVED=true is required to enable configured push.")
        else:
            require(
                not env.get("NOTIFICATION_HUB_NAME") and not env.get("NOTIFICATION_HUB_CONNECTION_SECRET_URI"),
                "Disabled push must not carry Notification Hubs configuration.",
            )
        if apply:
            for gate in ("SQL_BOOTSTRAP_APPROVED", "APPLICATION_ROLLOUT_APPROVED"):
                require(env.get(gate) == "true", f"{gate}=true is required; Entra user/schema/network and runtime/security/provider-status gates are separate.")


def run(command, *, env, capture=True):
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, check=True, capture_output=capture)
    return result.stdout.strip() if capture else ""


def az(arguments, env):
    return run(["az", *arguments, "--output", "json", "--only-show-errors"], env=env)


def check_account(env):
    account = json.loads(az(["account", "show"], env))
    require(
        account.get("id", "").lower() == env["AZURE_SUBSCRIPTION_ID"].lower()
        and account.get("tenantId", "").lower() == env["AZURE_TENANT_ID"].lower(),
        "The active Azure subscription/tenant does not match the explicitly selected target.",
    )


def field(data, *keys):
    for key in keys:
        require(isinstance(data, dict) and key in data, f"Foundation output is missing {'.'.join(keys)}; bootstrap must succeed first.")
        data = data[key]
    require(isinstance(data, str) and bool(data), f"Foundation output {'.'.join(keys)} must be a nonempty string.")
    return data


def validate_foundation(foundation, environment, env):
    require(isinstance(foundation, dict) and foundation.get("schemaVersion") == 1, "Unsupported/missing foundation handoff.")
    group_id = f"/subscriptions/{env['AZURE_SUBSCRIPTION_ID']}/resourceGroups/{env['AZURE_RESOURCE_GROUP']}"
    require(
        foundation.get("environmentName") == environment
        and field(foundation, "resourceGroupId").lower() == group_id.lower(),
        "Foundation handoff belongs to a different environment/resource group.",
    )
    field(foundation, "location")
    for section, resource_type in (
        ("registry", "Microsoft.ContainerRegistry/registries"),
        ("identity", "Microsoft.ManagedIdentity/userAssignedIdentities"),
        ("keyVault", "Microsoft.KeyVault/vaults"),
        ("containerEnvironment", "Microsoft.App/managedEnvironments"),
    ):
        name = field(foundation, section, "name")
        expected = f"{group_id}/providers/{resource_type}/{name}"
        require(field(foundation, section, "id").lower() == expected.lower(), f"Unexpected {section} resource ID in foundation handoff.")
    registry = field(foundation, "registry", "name")
    require(bool(re.fullmatch(r"[a-z0-9]{5,50}", registry)), "Invalid registry name in foundation handoff.")
    require(field(foundation, "registry", "loginServer") == f"{registry}.azurecr.io", "Unexpected registry hostname.")
    vault = field(foundation, "keyVault", "name")
    require(field(foundation, "keyVault", "uri") == f"https://{vault}.vault.azure.net/", "Unexpected Key Vault hostname.")
    sql_server = field(foundation, "sql", "serverName")
    require(field(foundation, "sql", "serverFqdn") == f"{sql_server}.database.windows.net", "Unexpected SQL hostname.")
    require(field(foundation, "sql", "databaseName") == "calledit", "Unexpected SQL database name.")
    required_uuid({"CLIENT_ID": field(foundation, "identity", "clientId")}, "CLIENT_ID")
    field(foundation, "identity", "principalId")
    for app in ("apiName", "workersName"):
        require(bool(re.fullmatch(r"[a-z][a-z0-9-]{0,30}[a-z0-9]", field(foundation, "applications", app))), "Invalid application name.")


def load_foundation(environment, env):
    deployment = json.loads(az([
        "deployment", "group", "show", "--resource-group", env["AZURE_RESOURCE_GROUP"],
        "--name", f"calledit-{environment}-foundation",
    ], env))
    properties = deployment.get("properties", {})
    require(properties.get("provisioningState") == "Succeeded", "Foundation deployment has not succeeded; no image build or rollout is allowed.")
    foundation = properties.get("outputs", {}).get("foundation", {}).get("value")
    validate_foundation(foundation, environment, env)
    registry = json.loads(az([
        "acr", "show", "--name", foundation["registry"]["name"], "--resource-group", env["AZURE_RESOURCE_GROUP"],
    ], env))
    require(
        registry.get("provisioningState") == "Succeeded"
        and registry.get("id", "").lower() == foundation["registry"]["id"].lower()
        and registry.get("loginServer") == foundation["registry"]["loginServer"],
        "The recorded ACR foundation is missing, incomplete or mismatched.",
    )
    require(
        registry.get("roleAssignmentMode") == "LegacyRegistryPermissions",
        "This slice requires ACR registry RBAC mode (LegacyRegistryPermissions); ABAC needs different repository role grants.",
    )
    return foundation


def application_parameters(foundation, environment, env):
    require(foundation["sql"].get("autoPauseDelay") == -1, "Application rollout requires SQL auto-pause disabled; cold SQL cannot serve competition.")
    for name, repository in (("API_IMAGE", "called-it-api"), ("WORKERS_IMAGE", "called-it-workers")):
        validate_image(env[name], repository, foundation["registry"]["loginServer"])
    vault_uri = foundation["keyVault"]["uri"]
    for name in ("AUTH_SIGNING_KEY_SECRET_URI", "CONTACTS_PEPPER_SECRET_URI", "NOTIFICATION_HUB_CONNECTION_SECRET_URI"):
        if env.get(name):
            require(env[name].startswith(f"{vault_uri}secrets/"), f"{name} must reference this foundation's Key Vault.")
    return {
        "environmentName": environment,
        "location": foundation["location"],
        "apiName": foundation["applications"]["apiName"],
        "workersName": foundation["applications"]["workersName"],
        "environmentId": foundation["containerEnvironment"]["id"],
        "identityId": foundation["identity"]["id"],
        "identityClientId": foundation["identity"]["clientId"],
        "registryServer": foundation["registry"]["loginServer"],
        "sqlServerFqdn": foundation["sql"]["serverFqdn"],
        "databaseName": foundation["sql"]["databaseName"],
        "revisionSuffix": env["APPLICATION_REVISION_SUFFIX"],
        "apiImage": env["API_IMAGE"],
        "workersImage": env["WORKERS_IMAGE"],
        "authSigningKeySecretUri": env["AUTH_SIGNING_KEY_SECRET_URI"],
        "contactsPepperSecretUri": env["CONTACTS_PEPPER_SECRET_URI"],
        "appleAudience": env["SOCIAL_AUTH_APPLE_AUDIENCE"],
        "googleAudience": env["SOCIAL_AUTH_GOOGLE_AUDIENCE"],
        "pushProvider": env.get("PUSH_PROVIDER", "Disabled"),
        "notificationHubName": env.get("NOTIFICATION_HUB_NAME", ""),
        "notificationHubConnectionSecretUri": env.get("NOTIFICATION_HUB_CONNECTION_SECRET_URI", ""),
        "apiMinReplicas": integer(env, "API_MIN_REPLICAS", 1, 1, 3),
        "apiMaxReplicas": integer(env, "API_MAX_REPLICAS", 2, 1, 3),
        "apiHttpConcurrentRequests": integer(env, "API_HTTP_CONCURRENT_REQUESTS", 20, 1, 100),
        "workerMinReplicas": 1,
        "workerMaxReplicas": 1,
    }


def check_sql(foundation, env):
    sql = foundation["sql"]
    database = json.loads(az([
        "sql", "db", "show", "--resource-group", env["AZURE_RESOURCE_GROUP"],
        "--server", sql["serverName"], "--name", sql["databaseName"],
    ], env))
    expected_id = f"{foundation['resourceGroupId']}/providers/Microsoft.Sql/servers/{sql['serverName']}/databases/{sql['databaseName']}"
    require(
        database.get("id", "").lower() == expected_id.lower()
        and database.get("autoPauseDelay") == -1 and database.get("status") == "Online",
        "Live SQL must be the recorded database, Online and configured never to auto-pause; saved outputs alone are insufficient.",
    )


def check_revision_suffix(foundation, env):
    apps = json.loads(az(["containerapp", "list", "--resource-group", env["AZURE_RESOURCE_GROUP"]], env))
    require(isinstance(apps, list), "Could not inspect existing app revisions before rollout.")
    existing = {app["name"] for app in apps}
    for name in foundation["applications"].values():
        if name in existing:
            revisions = json.loads(az([
                "containerapp", "revision", "list", "--resource-group", env["AZURE_RESOURCE_GROUP"], "--name", name,
            ], env))
            require(isinstance(revisions, list), f"Could not inspect revision names for {name}.")
            requested = f"{name}--{env['APPLICATION_REVISION_SUFFIX']}"
            require(
                all(revision.get("name") != requested for revision in revisions),
                "APPLICATION_REVISION_SUFFIX already exists. Use a new workflow run/attempt, including on rollback or secret rotation.",
            )


def compile_foundation(environment, env):
    result = json.loads(run([
        env.get("BICEP", "bicep"), "build-params", f"infra/main.{environment}.bicepparam", "--stdout",
    ], env=env))
    return json.loads(result["templateJson"]), json.loads(result["parametersJson"])


def deploy_template(template, parameters, phase, environment, apply, env):
    with tempfile.TemporaryDirectory(prefix="calledit-deployment-") as directory:
        template_path = Path(directory) / "template.json"
        parameters_path = Path(directory) / "parameters.json"
        template_path.write_text(json.dumps(template), encoding="utf-8")
        parameters_path.write_text(json.dumps(parameters), encoding="utf-8")
        arguments = [
            "deployment", "group", "create" if apply else "what-if",
            "--resource-group", env["AZURE_RESOURCE_GROUP"], "--name", f"calledit-{environment}-{phase}",
            "--mode", "Incremental", "--template-file", str(template_path),
            "--parameters", f"@{parameters_path}",
        ]
        if not apply:
            run(["az", *arguments], env=env, capture=False)
            print("Read-only what-if completed. No resources or applications were deployed.")
            return
        result = json.loads(az(arguments, env))
        require(result.get("properties", {}).get("provisioningState") == "Succeeded", f"{phase} deployment did not succeed.")


def manifest_digest(registry, image, env):
    digest = json.loads(az([
        "acr", "repository", "show", "--name", registry, "--image", image, "--query", "digest",
    ], env))
    require(isinstance(digest, str) and DIGEST.fullmatch(digest) is not None, "ACR did not return an immutable manifest digest.")
    return digest


def summary(title, lines, env):
    text = f"### {title}\n\n" + "\n".join(lines) + "\n"
    print(text)
    if env.get("GITHUB_STEP_SUMMARY"):
        with Path(env["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as output:
            output.write(text)


def build_images(foundation, apply, env):
    if not apply:
        print("Foundation/ACR exist. Read-only build plan: no Docker build, registry login or push was performed.")
        return
    registry = foundation["registry"]
    run(["az", "acr", "login", "--name", registry["name"]], env=env, capture=False)
    images = {}
    for repository, dockerfile, output_name in (
        ("called-it-api", "Dockerfile", "api_image"),
        ("called-it-workers", "Dockerfile.workers", "workers_image"),
    ):
        tag = f"{registry['loginServer']}/{repository}:{env['IMAGE_TAG']}"
        run(["docker", "build", "--platform", "linux/amd64", "--file", dockerfile, "--tag", tag, "."], env=env, capture=False)
        run(["docker", "push", tag], env=env, capture=False)
        digest = manifest_digest(registry["name"], f"{repository}:{env['IMAGE_TAG']}", env)
        images[output_name] = f"{registry['loginServer']}/{repository}@{digest}"
    if env.get("GITHUB_OUTPUT"):
        with Path(env["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
            for key, value in images.items():
                output.write(f"{key}={value}\n")
    summary("Built immutable image pair; no app rollout", [f"- {key}: `{value}`" for key, value in images.items()], env)


def verify_health(fqdn, env):
    require(bool(re.fullmatch(r"[a-z0-9.-]+\.azurecontainerapps\.io", fqdn)), "Unexpected API ingress hostname; refusing health request.")
    for path in ("/health/live", "/health/ready"):
        for attempt in range(12):
            try:
                status = run([
                    "curl", "--proto", "=https", "--fail", "--silent", "--show-error",
                    "--connect-timeout", "5", "--max-time", "10", "--output", os.devnull,
                    "--write-out", "%{http_code}", f"https://{fqdn}{path}",
                ], env=env)
                if status == "200":
                    break
            except subprocess.CalledProcessError:
                print(f"API {path} attempt {attempt + 1}/12 failed.", file=sys.stderr)
            if attempt == 11:
                raise DeploymentError(f"API {path} did not return HTTP 200. Rollout is not successful; inspect/redeploy a compatible previous image pair.")
            time.sleep(5)


def verify_application(foundation, env):
    fqdn = ""
    expected = {
        foundation["applications"]["apiName"]: env["API_IMAGE"],
        foundation["applications"]["workersName"]: env["WORKERS_IMAGE"],
    }
    for attempt in range(40):
        ready = True
        for name, image in expected.items():
            app = json.loads(az([
                "containerapp", "show", "--resource-group", env["AZURE_RESOURCE_GROUP"], "--name", name,
            ], env))
            properties = app.get("properties", {})
            state = properties.get("provisioningState")
            require(state not in ("Failed", "Canceled"), f"{name} provisioning failed; no successful rollout is reported.")
            latest = properties.get("latestRevisionName")
            containers = properties.get("template", {}).get("containers", [])
            ready = ready and (
                state == "Succeeded"
                and properties.get("runningStatus") == "Running"
                and latest == f"{name}--{env['APPLICATION_REVISION_SUFFIX']}"
                and properties.get("latestReadyRevisionName") == latest
                and len(containers) == 1
                and containers[0].get("image") == image
            )
            if name == foundation["applications"]["apiName"]:
                fqdn = properties.get("configuration", {}).get("ingress", {}).get("fqdn", "")
        if ready:
            verify_health(fqdn, env)
            return fqdn
        if attempt < 39:
            time.sleep(15)
    raise DeploymentError("Timed out waiting for both desired revisions. Worker status is process/control-plane health, not proof of job correctness.")


def execute(phase, environment, apply, env):
    # Repeat every local guard here so callers cannot skip the workflow's pre-login check.
    preflight(phase, environment, apply, env)
    if phase == "plan":
        print("Local plan only: no Azure login, queries, image builds or paid mutations.")
        return
    check_account(env)
    if phase == "foundation":
        template, parameters = compile_foundation(environment, env)
        deploy_template(template, parameters, phase, environment, apply, env)
        if apply:
            summary("Foundation updated; applications were not deployed", [
                "Entra users/schema, network reachability and versioned secrets remain separate gates.",
                "This is not evidence of application usability, capacity or affordability.",
            ], env)
        return
    foundation = load_foundation(environment, env)
    if phase == "build-images":
        build_images(foundation, apply, env)
        return
    values = application_parameters(foundation, environment, env)
    check_sql(foundation, env)
    check_revision_suffix(foundation, env)
    for image in (env["API_IMAGE"], env["WORKERS_IMAGE"]):
        repository_digest = image.split("/", 1)[1]
        digest = manifest_digest(foundation["registry"]["name"], repository_digest, env)
        require(image.endswith(f"@{digest}"), "The requested image digest is not present in the foundation registry.")
    template = json.loads(run([env.get("BICEP", "bicep"), "build", "infra/application.bicep", "--stdout"], env=env))
    parameters = {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {key: {"value": value} for key, value in values.items()},
    }
    deploy_template(template, parameters, phase, environment, apply, env)
    if apply:
        fqdn = verify_application(foundation, env)
        summary("Application revisions ready; not a public release", [
            f"- API live/ready: https://{fqdn}",
            "- Worker desired revision is running; no HTTP worker health or gameplay guarantee is implied.",
            "- SMS and scheduled competition workers remain disabled; provider/security/gameplay gates remain.",
            f"- API image: `{env['API_IMAGE']}`",
            f"- Worker image: `{env['WORKERS_IMAGE']}`",
        ], env)


def main(argv=None, environ=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=PHASES, default="plan")
    parser.add_argument("--environment", choices=("dev", "prod"), default="dev")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--execute", action="store_true", help="Allow Azure access after local preflight (default: none).")
    mode.add_argument("--check", action="store_true", help="Check all selected approval/input gates locally, including --apply intent.")
    parser.add_argument("--apply", action="store_true", help="Explicitly allow paid mutation (default: what-if/read-only).")
    args = parser.parse_args(argv)
    env = dict(os.environ if environ is None else environ)
    try:
        require(not args.apply or args.execute or args.check, "--apply requires --execute or explicit local --check.")
        preflight(args.phase, args.environment, args.apply, env)
        if args.execute:
            execute(args.phase, args.environment, args.apply, env)
        elif args.phase == "plan":
            print("Local plan only: no Azure login, queries, image builds or paid mutations.")
        else:
            print(f"Local {args.phase} preflight passed. No Azure commands were run.")
        return 0
    except (DeploymentError, subprocess.CalledProcessError, OSError, json.JSONDecodeError) as error:
        print(f"Deployment stopped: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
