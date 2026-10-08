import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import deploy


def fixture_env():
    # Format-only fixtures. These are not credentials, subscription evidence or deployable settings.
    return {
        "AZURE_DEPLOY_ENABLED": "true",
        "AZURE_ENVIRONMENT_APPROVAL_CONFIGURED": "true",
        "AZURE_COST_APPROVED": "true",
        "AZURE_FOUNDATION_APPROVED": "true",
        "SQL_BOOTSTRAP_APPROVED": "true",
        "APPLICATION_ROLLOUT_APPROVED": "true",
        "AZURE_SUBSCRIPTION_ID": "11111111-1111-4111-8111-111111111111",
        "AZURE_TENANT_ID": "22222222-2222-4222-8222-222222222222",
        "AZURE_CLIENT_ID": "33333333-3333-4333-8333-333333333333",
        "AZURE_RESOURCE_GROUP": "fixture-rg",
        "AZURE_LOCATION": "ownerregion",
        "SQL_ENTRA_ADMIN_OBJECT_ID": "44444444-4444-4444-8444-444444444444",
        "SQL_ENTRA_ADMIN_LOGIN": "fixture-admin",
        "IMAGE_TAG": "a" * 40 + "-123-1",
        "API_IMAGE": "fixtureacr.azurecr.io/called-it-api@sha256:" + "a" * 64,
        "WORKERS_IMAGE": "fixtureacr.azurecr.io/called-it-workers@sha256:" + "b" * 64,
        "APPLICATION_REVISION_SUFFIX": "r123-1",
        "AUTH_SIGNING_KEY_SECRET_URI": "https://fixture-kv.vault.azure.net/secrets/signing-key/" + "a" * 32,
        "CONTACTS_PEPPER_SECRET_URI": "https://fixture-kv.vault.azure.net/secrets/contacts-pepper/" + "b" * 32,
        "SOCIAL_AUTH_APPLE_AUDIENCE": "fixture.apple.audience",
        "SOCIAL_AUTH_GOOGLE_AUDIENCE": "fixture.google.audience",
    }


def fixture_foundation(env):
    group = f"/subscriptions/{env['AZURE_SUBSCRIPTION_ID']}/resourceGroups/{env['AZURE_RESOURCE_GROUP']}"

    def resource(kind, name):
        return {"name": name, "id": f"{group}/providers/{kind}/{name}"}

    return {
        "schemaVersion": 1,
        "environmentName": "dev",
        "location": "ownerregion",
        "resourceGroupId": group,
        "registry": {
            **resource("Microsoft.ContainerRegistry/registries", "fixtureacr"),
            "loginServer": "fixtureacr.azurecr.io",
        },
        "identity": {
            **resource("Microsoft.ManagedIdentity/userAssignedIdentities", "fixture-dev-id"),
            "clientId": "55555555-5555-4555-8555-555555555555",
            "principalId": "66666666-6666-4666-8666-666666666666",
        },
        "keyVault": {
            **resource("Microsoft.KeyVault/vaults", "fixture-kv"),
            "uri": "https://fixture-kv.vault.azure.net/",
        },
        "containerEnvironment": resource("Microsoft.App/managedEnvironments", "fixture-dev-cae"),
        "sql": {
            "serverName": "fixture-dev-sql",
            "serverFqdn": "fixture-dev-sql.database.windows.net",
            "databaseName": "calledit",
            "autoPauseDelay": -1,
        },
        "applications": {"apiName": "fixture-dev-api", "workersName": "fixture-dev-workers"},
    }


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.env = fixture_env()

    def test_default_plan_never_calls_external_commands(self):
        with patch.object(deploy, "run") as run, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(deploy.main([], {}), 0)
            self.assertEqual(deploy.main(["--execute"], {}), 0)
        run.assert_not_called()

    def test_positive_local_checks_for_all_phases_and_environments(self):
        for phase in deploy.PHASES:
            for environment in ("dev", "prod"):
                with self.subTest(phase=phase, environment=environment):
                    deploy.preflight(phase, environment, False, self.env)
                    if phase != "plan":
                        deploy.preflight(phase, environment, True, self.env)

    def test_local_apply_check_does_not_call_azure(self):
        with patch.object(deploy, "run") as run, contextlib.redirect_stdout(io.StringIO()):
            result = deploy.main(["--phase", "application", "--apply", "--check"], self.env)
        self.assertEqual(result, 0)
        run.assert_not_called()

    def test_apply_requires_explicit_mode_and_plan_never_applies(self):
        for args in (["--apply"], ["--phase", "plan", "--execute", "--apply"]):
            with self.subTest(args=args), patch.object(deploy, "run") as run, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(deploy.main(args, self.env), 1)
                run.assert_not_called()

    def test_disabled_manual_and_push_execution_fail_before_commands(self):
        variants = [
            {"AZURE_DEPLOY_ENABLED": ""},
            {"AZURE_ENVIRONMENT_APPROVAL_CONFIGURED": ""},
            {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main"},
            {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/feature"},
        ]
        for changes in variants:
            with self.subTest(changes=changes), patch.object(deploy, "run") as run, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(deploy.main(["--phase", "foundation", "--execute", "--apply"], self.env | changes), 1)
                run.assert_not_called()

    def test_missing_approvals_fail_for_mutation_not_readonly(self):
        for gate in ("AZURE_COST_APPROVED", "AZURE_FOUNDATION_APPROVED", "SQL_BOOTSTRAP_APPROVED", "APPLICATION_ROLLOUT_APPROVED"):
            env = self.env | {gate: ""}
            with self.subTest(gate=gate):
                deploy.preflight("application", "dev", False, env)
                with self.assertRaisesRegex(deploy.DeploymentError, gate):
                    deploy.preflight("application", "dev", True, env)

    def test_missing_application_inputs_fail_before_even_a_cloud_read(self):
        names = (
            "API_IMAGE", "WORKERS_IMAGE", "APPLICATION_REVISION_SUFFIX", "AUTH_SIGNING_KEY_SECRET_URI", "CONTACTS_PEPPER_SECRET_URI",
            "SOCIAL_AUTH_APPLE_AUDIENCE", "SOCIAL_AUTH_GOOGLE_AUDIENCE",
        )
        for name in names:
            with self.subTest(name=name), patch.object(deploy, "run") as run, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(deploy.main(["--phase", "application", "--execute", "--apply"], self.env | {name: ""}), 1)
                run.assert_not_called()

    def test_mutable_or_wrong_image_references_are_rejected(self):
        for image in (
            "", "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest",
            "fixtureacr.azurecr.io/called-it-api:abc123", self.env["API_IMAGE"] + ":latest",
            self.env["API_IMAGE"].replace("a" * 64, "g" * 64),
            self.env["API_IMAGE"].replace("a" * 64, "a" * 63),
            self.env["API_IMAGE"].replace("called-it-api", "another-repo"),
            self.env["API_IMAGE"] + "\n",
        ):
            with self.subTest(image=image), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("application", "dev", False, self.env | {"API_IMAGE": image})

    def test_secret_references_must_be_versioned_not_values(self):
        for uri in ("", "not-a-secret-value", "https://fixture-kv.vault.azure.net/secrets/signing-key", self.env["AUTH_SIGNING_KEY_SECRET_URI"] + "?query=1"):
            with self.subTest(uri=uri), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("application", "dev", False, self.env | {"AUTH_SIGNING_KEY_SECRET_URI": uri})

    def test_bounds_prevent_cold_api_or_unbounded_scaling(self):
        for changes in (
            {"API_MIN_REPLICAS": "0"}, {"API_MAX_REPLICAS": "4"},
            {"API_MIN_REPLICAS": "3", "API_MAX_REPLICAS": "2"},
            {"API_HTTP_CONCURRENT_REQUESTS": "0"}, {"API_HTTP_CONCURRENT_REQUESTS": "101"},
            {"API_MAX_REPLICAS": "abc"},
        ):
            with self.subTest(changes=changes), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("application", "dev", False, self.env | changes)

    def test_hubs_require_intentional_complete_configuration(self):
        for changes in (
            {"PUSH_PROVIDER": "Development"},
            {"PUSH_PROVIDER": "NotificationHubs"},
            {"NOTIFICATION_HUB_NAME": "unused-hub"},
        ):
            with self.subTest(changes=changes), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("application", "dev", False, self.env | changes)
        configured = self.env | {
            "PUSH_PROVIDER": "NotificationHubs",
            "NOTIFICATION_HUB_NAME": "fixture-hub",
            "NOTIFICATION_HUB_CONNECTION_SECRET_URI": "https://fixture-kv.vault.azure.net/secrets/hub/" + "c" * 32,
        }
        deploy.preflight("application", "dev", False, configured)
        with self.assertRaisesRegex(deploy.DeploymentError, "PUSH_CONFIGURATION_APPROVED"):
            deploy.preflight("application", "dev", True, configured)
        deploy.preflight("application", "dev", True, configured | {"PUSH_CONFIGURATION_APPROVED": "true"})

    def test_foundation_requires_region_admin_and_valid_prefix(self):
        for changes in (
            {"AZURE_LOCATION": ""}, {"AZURE_LOCATION": "ci-only-not-a-region"},
            {"SQL_ENTRA_ADMIN_OBJECT_ID": ""}, {"SQL_ENTRA_ADMIN_LOGIN": ""},
            {"SQL_ENTRA_ADMIN_OBJECT_ID": "00000000-0000-0000-0000-000000000001"},
            {"SQL_ENTRA_ADMIN_PRINCIPAL_TYPE": "unknown"}, {"AZURE_NAME_PREFIX": "Too-Long-Prefix"},
        ):
            with self.subTest(changes=changes), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("foundation", "dev", False, self.env | changes)

    def test_sql_firewall_rejects_allow_all_azure_cidrs_duplicates_and_bad_json(self):
        for addresses in ('["0.0.0.0"]', '["0.0.0.0/0"]', '["127.0.0.1"]', '["10.0.0.1"]', '["8.8.8.8","8.8.8.8"]', '[1]', '{}', 'invalid'):
            with self.subTest(addresses=addresses), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("foundation", "dev", False, self.env | {"SQL_ALLOWED_CLIENT_IPS": addresses})
        deploy.preflight("foundation", "dev", False, self.env | {"SQL_ALLOWED_CLIENT_IPS": '["8.8.8.8"]'})

    def test_build_tag_is_unique_full_commit_not_latest(self):
        for tag in ("latest", "abcdef", "a" * 40):
            with self.subTest(tag=tag), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("build-images", "dev", False, self.env | {"IMAGE_TAG": tag})

    def test_application_revision_suffix_is_explicit_and_bounded(self):
        for suffix in ("", "latest", "r1-1\n", "r" + "1" * 21 + "-1"):
            with self.subTest(suffix=suffix), self.assertRaises(deploy.DeploymentError):
                deploy.preflight("application", "dev", False, self.env | {"APPLICATION_REVISION_SUFFIX": suffix})

    def test_app_handoff_rejects_paused_sql_cross_registry_and_cross_vault(self):
        foundation = fixture_foundation(self.env)
        values = deploy.application_parameters(foundation, "dev", self.env)
        self.assertEqual(values["workerMinReplicas"], 1)
        self.assertEqual(values["workerMaxReplicas"], 1)
        self.assertEqual(values["pushProvider"], "Disabled")
        self.assertEqual(values["revisionSuffix"], self.env["APPLICATION_REVISION_SUFFIX"])
        paused = copy.deepcopy(foundation)
        paused["sql"]["autoPauseDelay"] = 60
        with self.assertRaisesRegex(deploy.DeploymentError, "auto-pause"):
            deploy.application_parameters(paused, "dev", self.env)
        for changes in (
            {"API_IMAGE": self.env["API_IMAGE"].replace("fixtureacr.", "anotheracr.")},
            {"AUTH_SIGNING_KEY_SECRET_URI": self.env["AUTH_SIGNING_KEY_SECRET_URI"].replace("fixture-kv.", "another-kv.")},
        ):
            with self.subTest(changes=changes), self.assertRaises(deploy.DeploymentError):
                deploy.application_parameters(foundation, "dev", self.env | changes)

    def test_foundation_handoff_is_bound_to_environment_group_and_resource_ids(self):
        foundation = fixture_foundation(self.env)
        deploy.validate_foundation(foundation, "dev", self.env)
        for key, value in (("environmentName", "prod"), ("resourceGroupId", "/wrong-group"), ("schemaVersion", 2)):
            with self.subTest(key=key), self.assertRaises(deploy.DeploymentError):
                deploy.validate_foundation(foundation | {key: value}, "dev", self.env)
        changed = copy.deepcopy(foundation)
        changed["registry"]["id"] += "-other"
        with self.assertRaises(deploy.DeploymentError):
            deploy.validate_foundation(changed, "dev", self.env)


class ExecutionTests(unittest.TestCase):
    """All Azure/Docker/HTTP processes are mocked, including the successful paths."""

    def setUp(self):
        self.env = fixture_env()
        self.foundation = fixture_foundation(self.env)
        self.commands = []
        self.deployment_parameters = []
        self.failure = None

    def fake_run(self, command, *, env, capture=True):
        self.commands.append(command)
        if command[:3] == ["az", "account", "show"]:
            return json.dumps({
                "id": "wrong-subscription" if self.failure == "account" else env["AZURE_SUBSCRIPTION_ID"],
                "tenantId": env["AZURE_TENANT_ID"],
            })
        if command[:4] == ["az", "deployment", "group", "show"]:
            return json.dumps({"properties": {
                "provisioningState": "Failed" if self.failure == "foundation" else "Succeeded",
                "outputs": {"foundation": {"value": self.foundation}},
            }})
        if command[:3] == ["az", "acr", "show"]:
            if self.failure == "registry":
                raise subprocess.CalledProcessError(3, command, stderr="fixture registry does not exist")
            return json.dumps(self.foundation["registry"] | {
                "provisioningState": "Succeeded",
                "roleAssignmentMode": "AbacRepositoryPermissions" if self.failure == "abac" else "LegacyRegistryPermissions",
            })
        if command[:2] == ["bicep", "build-params"]:
            return json.dumps({
                "templateJson": json.dumps({"resources": []}),
                "parametersJson": json.dumps({"parameters": {}}),
            })
        if command[:2] == ["bicep", "build"]:
            return json.dumps({"resources": []})
        if command[:4] == ["az", "sql", "db", "show"]:
            return json.dumps({
                "id": self.foundation["resourceGroupId"] + "/providers/Microsoft.Sql/servers/fixture-dev-sql/databases/calledit",
                "autoPauseDelay": 60 if self.failure == "cold-sql" else -1,
                "status": "Online",
            })
        if command[:3] == ["az", "deployment", "group"] and command[3] in ("create", "what-if"):
            self.assertEqual(command[command.index("--mode") + 1], "Incremental")
            path = command[command.index("--parameters") + 1]
            self.assertTrue(path.startswith("@"))
            self.deployment_parameters.append(json.loads(Path(path[1:]).read_text()))
            return json.dumps({"properties": {"provisioningState": "Failed" if self.failure == "deployment" else "Succeeded"}})
        if command[:3] == ["az", "acr", "login"] or command[0] == "docker":
            if self.failure == "push" and command[:2] == ["docker", "push"]:
                raise subprocess.CalledProcessError(1, command)
            return ""
        if command[:4] == ["az", "acr", "repository", "show"]:
            if self.failure == "manifest":
                raise subprocess.CalledProcessError(3, command, stderr="fixture manifest missing")
            image = command[command.index("--image") + 1]
            return json.dumps("sha256:" + ("a" if image.startswith("called-it-api") else "b") * 64)
        if command[:3] == ["az", "containerapp", "list"]:
            return json.dumps([{"name": "fixture-dev-api"}] if self.failure == "reused-revision" else [])
        if command[:4] == ["az", "containerapp", "revision", "list"]:
            return json.dumps([{"name": "fixture-dev-api--" + env["APPLICATION_REVISION_SUFFIX"]}])
        if command[:3] == ["az", "containerapp", "show"]:
            name = command[command.index("--name") + 1]
            worker = name.endswith("-workers")
            return json.dumps({"properties": {
                "provisioningState": "Failed" if worker and self.failure == "worker" else "Succeeded",
                "runningStatus": "Running",
                "latestRevisionName": f"{name}--{'old' if self.failure == 'stale-revision' else env['APPLICATION_REVISION_SUFFIX']}",
                "latestReadyRevisionName": f"{name}--{'old' if self.failure in ('revision', 'stale-revision') else env['APPLICATION_REVISION_SUFFIX']}",
                "template": {"containers": [{"image": env["WORKERS_IMAGE" if worker else "API_IMAGE"]}]},
                "configuration": {} if worker else {"ingress": {"fqdn": "fixture-api.fixture.azurecontainerapps.io"}},
            }})
        if command[0] == "curl":
            if self.failure == "health" and command[-1].endswith("/health/ready"):
                raise subprocess.CalledProcessError(22, command, output="503")
            if self.failure == "redirect":
                return "302"
            return "200"
        raise AssertionError(f"Unexpected command in local-only test: {command}")

    def call(self, phase, apply=False):
        output = io.StringIO()
        error = io.StringIO()
        args = ["--phase", phase, "--environment", "dev", "--execute"]
        if apply:
            args.append("--apply")
        with patch.object(deploy, "run", side_effect=self.fake_run), patch.object(deploy.time, "sleep"), contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            status = deploy.main(args, self.env)
        return status, output.getvalue(), error.getvalue()

    def test_foundation_what_if_is_incremental_and_never_builds_or_updates_apps(self):
        status, output, _ = self.call("foundation")
        self.assertEqual(status, 0)
        self.assertIn("Read-only what-if", output)
        self.assertTrue(any(command[:4] == ["az", "deployment", "group", "what-if"] for command in self.commands))
        self.assertFalse(any("create" in command or command[0] == "docker" or "containerapp" in command for command in self.commands))

    def test_foundation_apply_does_not_require_images_or_touch_app_revisions(self):
        self.env.pop("API_IMAGE")
        self.env.pop("WORKERS_IMAGE")
        status, output, _ = self.call("foundation", True)
        self.assertEqual(status, 0)
        self.assertIn("applications were not deployed", output)
        self.assertFalse(any(command[0] == "docker" or "containerapp" in command for command in self.commands))

    def test_build_readonly_performs_no_registry_login_build_or_push(self):
        status, _, _ = self.call("build-images")
        self.assertEqual(status, 0)
        self.assertFalse(any(command[0] == "docker" or "login" in command for command in self.commands))

    def test_build_checks_foundation_and_acr_before_login_then_publishes_digests(self):
        status, output, _ = self.call("build-images", True)
        self.assertEqual(status, 0)
        acr_check = next(i for i, command in enumerate(self.commands) if command[:3] == ["az", "acr", "show"])
        login = next(i for i, command in enumerate(self.commands) if command[:3] == ["az", "acr", "login"])
        build = next(i for i, command in enumerate(self.commands) if command[:2] == ["docker", "build"])
        self.assertLess(acr_check, login)
        self.assertLess(login, build)
        self.assertIn(self.env["API_IMAGE"], output)
        self.assertIn(self.env["WORKERS_IMAGE"], output)
        self.assertFalse(any(":latest" in part for command in self.commands for part in command))
        self.assertFalse(any("create" in command or "containerapp" in command for command in self.commands))

    def test_failed_account_foundation_registry_or_abac_stops_before_mutation(self):
        for failure in ("account", "foundation", "registry", "abac"):
            with self.subTest(failure=failure):
                self.commands.clear()
                self.failure = failure
                status, output, _ = self.call("build-images", True)
                self.assertEqual(status, 1)
                self.assertNotIn("###", output)
                self.assertFalse(any(command[0] == "docker" or "create" in command or "login" in command for command in self.commands))

    def test_failed_push_does_not_report_an_image_pair(self):
        self.failure = "push"
        status, output, _ = self.call("build-images", True)
        self.assertEqual(status, 1)
        self.assertNotIn("###", output)

    def test_application_what_if_preserves_explicit_digest_inputs(self):
        status, output, _ = self.call("application")
        self.assertEqual(status, 0)
        self.assertIn("Read-only what-if", output)
        values = self.deployment_parameters[0]["parameters"]
        self.assertEqual(values["apiImage"]["value"], self.env["API_IMAGE"])
        self.assertEqual(values["workersImage"]["value"], self.env["WORKERS_IMAGE"])
        self.assertFalse(any("create" in command or command[:3] == ["az", "containerapp", "show"] or command[0] == "curl" for command in self.commands))

    def test_application_rejects_missing_manifest_before_deployment(self):
        self.failure = "manifest"
        status, _, _ = self.call("application", True)
        self.assertEqual(status, 1)
        self.assertFalse(any("create" in command for command in self.commands))

    def test_application_rechecks_actual_sql_settings_before_mutation(self):
        self.failure = "cold-sql"
        status, _, error = self.call("application", True)
        self.assertEqual(status, 1)
        self.assertIn("Live SQL", error)
        self.assertFalse(any("create" in command for command in self.commands))

    def test_application_rejects_reused_revision_suffix_before_mutation(self):
        self.failure = "reused-revision"
        status, _, error = self.call("application", True)
        self.assertEqual(status, 1)
        self.assertIn("already exists", error)
        self.assertFalse(any("create" in command for command in self.commands))

    def test_successful_application_checks_both_revisions_and_only_api_http_routes(self):
        status, output, _ = self.call("application", True)
        self.assertEqual(status, 0)
        self.assertIn("Application revisions ready; not a public release", output)
        urls = [command[-1] for command in self.commands if command[0] == "curl"]
        self.assertEqual(urls, [
            "https://fixture-api.fixture.azurecontainerapps.io/health/live",
            "https://fixture-api.fixture.azurecontainerapps.io/health/ready",
        ])
        app_names = [command[command.index("--name") + 1] for command in self.commands if command[:3] == ["az", "containerapp", "show"]]
        self.assertEqual(app_names, ["fixture-dev-api", "fixture-dev-workers"])
        self.assertFalse(any(command[:3] == ["az", "containerapp", "update"] for command in self.commands))

    def test_failed_deployment_revision_worker_or_health_never_writes_success_summary(self):
        for failure in ("deployment", "revision", "stale-revision", "worker", "health", "redirect"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(prefix="calledit-test-") as directory:
                self.commands.clear()
                self.failure = failure
                path = Path(directory) / "summary.txt"
                self.env["GITHUB_STEP_SUMMARY"] = str(path)
                status, output, error = self.call("application", True)
                self.assertEqual(status, 1)
                self.assertIn("Deployment stopped", error)
                self.assertNotIn("###", output)
                self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
