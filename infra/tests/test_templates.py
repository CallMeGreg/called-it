import json
import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
BICEP = os.environ.get("BICEP", "bicep")
COMPILE_FIXTURES = {
    "AZURE_LOCATION": "ci-only-not-a-region",
    "AZURE_NAME_PREFIX": "cifixture",
    "SQL_ENTRA_ADMIN_OBJECT_ID": "00000000-0000-0000-0000-000000000001",
    "SQL_ENTRA_ADMIN_LOGIN": "CI compilation only - not an administrator",
    "SQL_ENTRA_ADMIN_PRINCIPAL_TYPE": "Group",
    "SQL_ALLOWED_CLIENT_IPS": "[]",
}


def compile_json(*arguments, env=None):
    result = subprocess.run(
        [BICEP, *arguments, "--stdout"], cwd=ROOT, env=env,
        text=True, capture_output=True, check=True,
    )
    if result.stderr.strip():
        raise AssertionError(f"Bicep compilation must have no warnings: {result.stderr}")
    return json.loads(result.stdout)


def resources(template):
    value = template.get("resources", [])
    return list(value.values()) if isinstance(value, dict) else value


def all_resources(template):
    for resource in resources(template):
        yield resource
        nested = resource.get("properties", {}).get("template")
        if nested:
            yield from all_resources(nested)


def module(template, name):
    return next(resource for resource in resources(template) if resource["name"] == name)


class TemplatePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foundation = compile_json("build", "infra/main.bicep")
        cls.application = compile_json("build", "infra/application.bicep")
        cls.parameters = {}
        for environment in ("dev", "prod"):
            result = compile_json(
                "build-params", f"infra/main.{environment}.bicepparam",
                env={**os.environ, **COMPILE_FIXTURES},
            )
            cls.parameters[environment] = json.loads(result["parametersJson"])["parameters"]
            if json.loads(result["templateJson"]) != cls.foundation:
                raise AssertionError("Parameter compilation must target the actual foundation template.")

    def test_foundation_allowlist_excludes_apps_and_deferred_services(self):
        allowed = {
            "Microsoft.Resources/deployments",
            "Microsoft.ManagedIdentity/userAssignedIdentities",
            "Microsoft.OperationalInsights/workspaces",
            "Microsoft.ContainerRegistry/registries",
            "Microsoft.Authorization/roleAssignments",
            "Microsoft.KeyVault/vaults",
            "Microsoft.Sql/servers",
            "Microsoft.Sql/servers/firewallRules",
            "Microsoft.Sql/servers/databases",
            "Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies",
            "Microsoft.App/managedEnvironments",
        }
        self.assertEqual({resource["type"] for resource in all_resources(self.foundation)}, allowed)
        self.assertNotIn("apiImage", self.foundation["parameters"])
        self.assertNotIn("workersImage", self.foundation["parameters"])
        self.assertFalse(any(value["type"] == "secureString" for value in self.foundation["parameters"].values()))

    def test_both_parameter_files_have_explicit_warm_budget_hypotheses_not_secrets(self):
        for environment, values in self.parameters.items():
            with self.subTest(environment=environment):
                self.assertEqual(values["environmentName"]["value"], environment)
                self.assertEqual(values["location"]["value"], COMPILE_FIXTURES["AZURE_LOCATION"])
                self.assertEqual(values["sqlEntraAdminObjectId"]["value"], COMPILE_FIXTURES["SQL_ENTRA_ADMIN_OBJECT_ID"])
                self.assertEqual(values["sqlAutoPauseDelay"]["value"], -1)
                self.assertEqual(values["sqlMaxVcores"]["value"], 1)
                self.assertEqual(values["sqlMinVcores"]["value"], "0.5")
                self.assertEqual(values["sqlMaxSizeGb"]["value"], 5)
                self.assertEqual(values["logDailyCapGb"]["value"], "0.1")
                self.assertEqual(values["sqlAllowedClientIps"]["value"], [])

    def test_missing_required_parameter_environment_fails_without_empty_fallbacks(self):
        for required in ("AZURE_LOCATION", "SQL_ENTRA_ADMIN_OBJECT_ID", "SQL_ENTRA_ADMIN_LOGIN"):
            env = {**os.environ, **COMPILE_FIXTURES}
            env.pop(required)
            with self.subTest(required=required):
                result = subprocess.run(
                    [BICEP, "build-params", "infra/main.dev.bicepparam", "--stdout"],
                    cwd=ROOT, env=env, text=True, capture_output=True, check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(required, result.stderr)

    def test_sql_is_entra_only_warm_by_default_and_has_no_allow_all_azure_rule(self):
        template = module(self.foundation, "sql")["properties"]["template"]
        server = next(resource for resource in resources(template) if resource["type"] == "Microsoft.Sql/servers")
        self.assertTrue(server["properties"]["administrators"]["azureADOnlyAuthentication"])
        self.assertNotIn("administratorLoginPassword", server["properties"])
        self.assertEqual(template["parameters"]["autoPauseDelay"]["defaultValue"], -1)
        self.assertEqual(template["parameters"]["allowedClientIps"]["defaultValue"], [])
        self.assertNotIn("0.0.0.0", json.dumps(template))
        database = next(resource for resource in resources(template) if resource["type"] == "Microsoft.Sql/servers/databases")
        self.assertFalse(database["properties"]["zoneRedundant"])
        self.assertEqual(database["properties"]["requestedBackupStorageRedundancy"], "Local")
        self.assertEqual(database["properties"]["autoPauseDelay"], "[parameters('autoPauseDelay')]")

    def test_minimal_observability_registry_and_environment_defaults(self):
        template = module(self.foundation, "observability")["properties"]["template"]
        workspace = resources(template)[0]
        self.assertEqual(workspace["properties"]["retentionInDays"], 30)
        self.assertEqual(workspace["properties"]["workspaceCapping"]["dailyQuotaGb"], "[json(parameters('dailyCapGb'))]")
        template = module(self.foundation, "registry")["properties"]["template"]
        registry = next(resource for resource in resources(template) if resource["type"] == "Microsoft.ContainerRegistry/registries")
        self.assertEqual(registry["sku"]["name"], "Basic")
        self.assertFalse(registry["properties"]["adminUserEnabled"])
        self.assertEqual(registry["properties"]["roleAssignmentMode"], "LegacyRegistryPermissions")
        template = module(self.foundation, "containerEnv")["properties"]["template"]
        environment = next(resource for resource in resources(template) if resource["type"] == "Microsoft.App/managedEnvironments")
        self.assertFalse(environment["properties"]["zoneRedundant"])
        self.assertNotIn("daprAIConnectionString", environment["properties"])
        self.assertEqual(environment["properties"]["workloadProfiles"], [{"name": "Consumption", "workloadProfileType": "Consumption"}])

    def test_application_only_deploys_two_apps_with_required_image_inputs(self):
        types = [resource["type"] for resource in all_resources(self.application)]
        self.assertEqual(types.count("Microsoft.App/containerApps"), 2)
        self.assertEqual(set(types), {"Microsoft.Resources/deployments", "Microsoft.App/containerApps"})
        for name in ("apiImage", "workersImage", "revisionSuffix", "authSigningKeySecretUri", "contactsPepperSecretUri", "appleAudience", "googleAudience"):
            self.assertNotIn("defaultValue", self.application["parameters"][name])
        text = json.dumps(self.application)
        self.assertNotIn(":latest", text)
        self.assertNotIn("helloworld", text)

    def test_deployed_runtime_contract_is_production_and_fail_closed(self):
        common = self.application["variables"]["commonEnv"]
        for name, value in (
            ("ASPNETCORE_ENVIRONMENT", "Production"), ("DOTNET_ENVIRONMENT", "Production"),
            ("Database__Provider", "SqlServer"), ("Auth__Issuer", "called-it"),
            ("Auth__Audience", "called-it-clients"), ("SocialAuth__UseFake", "false"),
            ("Sms__Provider", "Disabled"), ("Resolution__UseStub", "false"),
            ("Workers__EnableDailySetBuilder", "false"), ("Workers__EnableResolver", "false"),
            ("Workers__EnableWindowClosing", "false"),
        ):
            with self.subTest(name=name):
                self.assertIn(f"createObject('name', '{name}', 'value', '{value}')", common)
        self.assertIn("'SocialAuth__AppleAudience', 'value', parameters('appleAudience')", common)
        self.assertIn("'SocialAuth__GoogleAudience', 'value', parameters('googleAudience')", common)
        self.assertIn("Authentication=Active Directory Managed Identity", common)
        self.assertIn("Encrypt=True;TrustServerCertificate=False", common)
        for obsolete in ("ConnectionStrings__Redis", "Acs__", "AppConfig__", "Storage__", "APPLICATIONINSIGHTS_CONNECTION_STRING", "AdminBootstrapPhones"):
            self.assertNotIn(obsolete, json.dumps(self.application))
        self.assertEqual(self.application["parameters"]["pushProvider"]["defaultValue"], "Disabled")

    def test_secret_values_are_not_template_parameters_or_outputs(self):
        api = module(self.application, "apiApp")["properties"]["template"]
        container = resources(api)[0]
        reference = container["properties"]["configuration"]["copy"][0]["input"]
        self.assertEqual(set(reference), {"name", "keyVaultUrl", "identity"})
        secrets = self.application["variables"]["commonSecrets"]
        self.assertIn("'Auth__SigningKey'", secrets)
        self.assertIn("'Contacts__Pepper'", secrets)
        self.assertIn("'NotificationHubs__ConnectionString'", secrets)
        self.assertNotIn("listKeys", json.dumps(self.application))
        self.assertEqual(set(self.application["outputs"]), {"apiName", "workersName"})

    def test_probes_ingress_and_http_scaling_are_api_only(self):
        api = module(self.application, "apiApp")
        worker = module(self.application, "workersApp")
        self.assertTrue(api["properties"]["parameters"]["externalIngress"]["value"])
        self.assertFalse(worker["properties"]["parameters"]["externalIngress"]["value"])
        template = api["properties"]["template"]
        properties = resources(template)[0]["properties"]
        self.assertEqual(properties["template"]["revisionSuffix"], "[parameters('revisionSuffix')]")
        self.assertTrue(properties["configuration"]["ingress"].startswith("[if(parameters('externalIngress'),"))
        self.assertTrue(properties["configuration"]["ingress"].endswith(", null())]"))
        container = properties["template"]["containers"][0]
        probes = container["probes"]
        self.assertTrue(probes.startswith("[if(parameters('externalIngress'),"))
        self.assertTrue(probes.endswith(", createArray())]"))
        self.assertIn("'type', 'Liveness'", probes)
        self.assertIn("'type', 'Readiness'", probes)
        self.assertEqual(probes.count("/health/live"), 2)
        self.assertEqual(probes.count("/health/ready"), 1)
        rules = properties["template"]["scale"]["rules"]
        self.assertTrue(rules.startswith("[if(parameters('externalIngress'),"))
        self.assertTrue(rules.endswith(", createArray())]"))
        self.assertIn("http-concurrency", rules)
        self.assertIn("parameters('httpConcurrentRequests')", rules)
        self.assertEqual(container["resources"], {"cpu": "[json('0.25')]", "memory": "0.5Gi"})

    def test_warm_replica_bounds_and_single_worker_are_explicit(self):
        parameters = self.application["parameters"]
        self.assertEqual(parameters["apiMinReplicas"]["defaultValue"], 1)
        self.assertEqual(parameters["apiMaxReplicas"]["defaultValue"], 2)
        self.assertEqual(parameters["apiMinReplicas"]["minValue"], 1)
        self.assertEqual(parameters["apiMaxReplicas"]["maxValue"], 3)
        self.assertEqual(parameters["apiHttpConcurrentRequests"]["defaultValue"], 20)
        for name in ("workerMinReplicas", "workerMaxReplicas"):
            self.assertEqual(parameters[name]["defaultValue"], 1)
            self.assertEqual(parameters[name]["allowedValues"], [1])
        worker = module(self.application, "workersApp")["properties"]["parameters"]
        self.assertEqual(worker["minReplicas"]["value"], "[parameters('workerMinReplicas')]")
        self.assertEqual(worker["maxReplicas"]["value"], "[parameters('workerMaxReplicas')]")


class WorkflowPolicyTests(unittest.TestCase):
    def test_default_and_push_paths_cannot_login_or_mutate(self):
        text = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertIn("default: plan", text)
        self.assertIn("type: boolean\n        default: false", text)
        self.assertIn("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.phase != 'plan'", text)
        self.assertIn("environment: ${{ inputs.environment }}", text)
        plan = text.split("  plan:", 1)[1].split("  azure:", 1)[0]
        self.assertNotIn("azure/login", plan)
        self.assertNotIn("id-token: write", plan)
        self.assertNotIn("--execute", plan)
        self.assertNotIn("--apply", plan)
        self.assertNotIn("always()", text)

    def test_preflight_runs_before_oidc_and_all_cloud_actions_use_guarded_script(self):
        text = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertLess(text.index("--check"), text.index("uses: azure/login@"))
        self.assertIn("AZURE_DEPLOY_ENABLED: ${{ vars.AZURE_DEPLOY_ENABLED }}", text)
        self.assertIn('if [[ "$APPLY" == \'true\' ]]; then', text)
        self.assertIn('args+=(--apply)', text)
        self.assertIn('python3 infra/scripts/deploy.py "${args[@]}"', text)
        for raw in ("az deployment group create", "az containerapp update", "docker push", "secrets.SQL_ADMIN_PASSWORD"):
            self.assertNotIn(raw, text)
        self.assertNotIn("GITHUB_STEP_SUMMARY", text)

    def test_ci_uses_local_fixtures_and_no_oidc_or_real_secrets(self):
        text = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertIn("python3 infra/scripts/validate.py", text)
        self.assertNotIn("secrets.", text)
        self.assertNotIn("azure/login", text)
        self.assertNotIn("id-token: write", text)
        self.assertIn("az bicep install --version v0.48.1", text)


if __name__ == "__main__":
    unittest.main()
