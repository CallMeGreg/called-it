# On-demand Azure TEST

TEST is an invite-only phone-browser POC, not a production deployment or a native app
distribution. One Container App serves the Expo React Native web export and .NET 10 API
at the same HTTPS origin. Rounds use shared, simulated questions/results and a
120-second clock. Request-driven advancement and database-backed boards allow the app
to scale to zero. The first request after idle can be slow.

**Start explicitly, play, then Stop.** A normal Start reserves four hours, including
provisioning and image builds. Extend adds four hours to that run's existing deadline.
An independent Azure watchdog initiates teardown after expiry even if GitHub is offline.
There is no automatic Start, scheduled deployment, or always-on application compute.

## Fixed scope and retained data

| Setting | Value |
| --- | --- |
| Subscription | `b5ccc8c6-8222-4b70-83a3-3d7de1e5920f` (`Called It - TEST`) |
| Tenant | `7b73b4a1-6b8a-47be-b3b0-0f441ef65a34` |
| Region | East US 2 (`eastus2`) |
| Persistent group | `called-it-test-data` |
| Disposable group | `called-it-test-run` |
| ACA service-managed group | `called-it-test-managed` |
| GitHub environment | `test` in `CallMeGreg/called-it` |

`infra/test/config.json` is the shared non-secret scope contract. Scripts require an
explicit isolated `AZURE_CONFIG_DIR`, reject a different current subscription/tenant
before mutation, pass `--subscription` on Azure CLI cloud calls, and restrict direct
ARM requests to the approved subscription. They never call `az account set`.
Do not bypass these guards or substitute dev/prod parameter files.

| Retained while Off | Removed by Stop |
| --- | --- |
| SQL Basic database: accounts, picks, results, scores | Container App and migration Job |
| SQL logical server, always public-network **Disabled** | ACA Consumption VNet environment and its managed LB/public IPs |
| Key Vault signing key, contact pepper, invites, owner recovery | SQL Private Endpoint, private DNS, VNet |
| Stable managed identities, federation and scoped RBAC | ACR Basic and both run images |
| Tiny non-secret lifecycle blob, Consumption Logic App, alerts | Log Analytics workspace |
| Empty run group and its foundational access grants | Deployment stack and its owned workload resources |

SQL is never SQLite on a container filesystem or Azure Files. It remains private-only
while Off; the next Start recreates its private access path. A new run has a new URL
and image registry, but the same accounts/results and private invite codes.
No Redis, Workers host, SMS, push, App Configuration, media storage, App Service plan,
NAT gateway, dedicated ACA profile, or ACA inbound Private Endpoint is provisioned.

Key Vault and the lifecycle storage account use public Azure service endpoints with
Entra/RBAC authentication. They are not anonymously readable. This lets the expiry
controller operate without a permanently billed VNet/private endpoint.

## IaC and identities

`infra/main.test.bicep` is the subscription-scoped retained foundation. It creates both
groups, identities, OIDC federation, narrow custom roles, SQL, Key Vault, controller
storage, the expiry workflow, Owner notifications, and a filtered monthly budget.
The database, vault and controller storage have `CanNotDelete` locks.

`infra/test/run.bicep` is deployed through one resource-group deployment stack with a
unique random run ID. Its three successive versions are network/registry, migration
Job, then application. Images must be digest-addressed images from that run's ACR.
There is no placeholder image, `latest` release, or imperative Container App update.
Removing stack-owned resources uses `actionOnUnmanage.resources=delete`; resource
groups remain detached rather than being deleted by the controller.

| Principal | Purpose / grants |
| --- | --- |
| Human operator | Subscription Owner (or equivalent bootstrap/budget/RBAC permissions); Key Vault Secrets Officer and lifecycle blob access are granted by Bicep |
| `called-it-test-deployer` | GitHub environment OIDC; Contributor only on run RG; conditional ACR role delegation; Reader on data RG; assignment of runtime/migrator UAMIs; SQL private-connection approval; lifecycle blob access |
| `called-it-test-runtime` | ACR pull; only the three application Key Vault secrets; SQL reader/writer contained user |
| `called-it-test-migrator` | ACR pull; SQL Entra administrator; assigned only to the private migration Job |
| `called-it-test-cleanup` | Controller blob access; read/delete of reviewed run resource types and stack/cancel operations; no SQL/KV/storage or RG deletion |

Deployer and cleanup also have subscription-level **group metadata read only**, needed
to verify that the service-created ACA group disappears. The deployer cannot read
`owner-recovery` or app secret values via its Key Vault grants. It is nevertheless a
**trusted deployment principal**: permission to start/update the migration Job can run
code as the SQL administrator. Restrict repository write access and TEST environment
approvals/allowed refs accordingly. Runtime is never the SQL server administrator.

## One-time operator bootstrap

Prerequisites: Node 24 LTS, Azure CLI with Bicep, GitHub CLI, and permission to configure
the GitHub `test` environment. Local Start additionally requires a running Docker
engine; GitHub's Ubuntu runner supplies one. No ACR Tasks permission is required.
The deployment ref must include the TEST backend/migration and `clients/mobile`, not
only these infrastructure files. Image creation fails if the required
`20261007031337_AddIsolatedTestRounds` migration is absent.

The operator must first authenticate interactively in a dedicated Azure CLI directory
and ensure that directory's selected subscription is the exact TEST subscription.
These scripts do not sign in or select another subscription. Reuse the same isolated
context for subsequent operator commands; never point it at the global `~/.azure`.

```bash
export AZURE_CONFIG_DIR="/absolute/path/to/the/isolated-test-azure-context"

# Read-only scope/provider check; a missing provider is an explicit failure.
node scripts/test/lifecycle.mjs preflight

# Operator-only opt-in to register the exact provider allowlist and apply Bicep.
node scripts/test/lifecycle.mjs bootstrap --register-providers
```

Without `--register-providers`, bootstrap refuses missing registrations. No Start
silently registers providers. Foundation redeployment preserves SQL data, identity
names, existing lifecycle state, and the budget's original start date. Do foundation
maintenance while TEST is Off. Unexpected preexisting group ownership is rejected.

Bootstrap emits only the non-secret deployer client ID, tenant ID, and subscription
ID. In GitHub Settings, create environment **test**, set its environment variable
`AZURE_TEST_CLIENT_ID` to that output, and configure approvers/allowed branches where
the repository plan supports them. Allow the reviewed feature branch during initial
verification. Azure federation already exists in Bicep with the exact subject:

```text
repo:CallMeGreg/called-it:environment:test
```

Do not put signing keys, invites, recovery material, or SQL passwords in GitHub
variables/secrets. Existing dev/prod OIDC settings are unchanged.

Generate the initial **one** tester in an owner-only folder outside every Git checkout:

```bash
node scripts/test/invites.mjs init --output "$HOME/.called-it-test/owner.json"
node scripts/test/lifecycle.mjs publish-secrets --file "$HOME/.called-it-test/owner.json"
```

The helper creates the final private folder as 0700 and the file as 0600. It rejects
symlink paths, permissive existing folders/files, Git trees and accidental overwrite.
Signing material and invites use cryptographically random 256-bit values. Publication
uses secure Bicep parameters in a temporary 0600 file, removes that file, and produces
no secret output. The recovery bundle is stored in a separate operator-only KV secret.
Repeated identical publication is a no-op. Generating a different signing key/pepper
and publishing over an existing installation is rejected; recover the existing bundle.

After bootstrap, the watchdog needs its first successful five-minute tick. Start and
Extend require an enabled, correctly scoped workflow with a successful run in the
last 15 minutes. If this check fails, inspect the expiry workflow/Owner alert; do not
disable the guard to proceed.

## Start, Status, Extend, Stop

Use the **existing registered** `deploy.yml` workflow. It routes TEST to
`deploy-test.yml` from the same ref, including before the new reusable workflow has
merged into the default branch. The existing dev/prod defaults and auto-deploy gate
are preserved; TEST runs only through explicit manual dispatch.

```bash
gh workflow run deploy.yml --ref <reviewed-ref> -f environment=test -f test_action=start
gh workflow run deploy.yml --ref <reviewed-ref> -f environment=test -f test_action=status

gh workflow run deploy.yml --ref <reviewed-ref> -f environment=test \
  -f test_action=extend -f test_run_id=<current-run-id>

# Review Status/inventory first, then repeat the exact run ID as confirmation.
gh workflow run deploy.yml --ref <reviewed-ref> -f environment=test \
  -f test_action=stop -f test_run_id=<current-run-id> -f confirm_stop=<current-run-id>
```

Start performs these phases, in order:

1. Verify scope/providers, private SQL, watchdog heartbeat, secret-version metadata,
   Docker availability and absence of old disposable/managed resources.
2. Lease the state blob; require Idle; allocate a unique run and persist Starting plus
   its four-hour expiry **before** provisioning paid resources.
3. Compile/apply Bicep network/registry stage. Build the migration and API+web images
   on the runner, push to ACR, resolve immutable digests.
4. Apply the Job stage, start one execution inside the VNet, and require success.
5. Apply the API stage with the agreed settings, require database readiness, a served
   HTML page and its same-origin JavaScript assets, then record Running and print the
   non-secret HTTPS URL/run ID.

A failed Start attempts the same guarded Stop. A lost/cancelled runner cannot disable
the independent expiry watchdog. A Start against a non-Idle state fails rather than
resetting a deadline or deploying an empty-image template over an existing app.

Operator equivalents, including emergency Stop while a GitHub Start is still running:

```bash
node scripts/test/lifecycle.mjs start
node scripts/test/lifecycle.mjs status
node scripts/test/lifecycle.mjs extend --run-id <current-run-id>
node scripts/test/lifecycle.mjs stop --run-id <current-run-id> --confirm <current-run-id>
```

GitHub operations serialize through the caller workflow's TEST concurrency group.
There is no second reusable-workflow concurrency lock. A GitHub Stop can queue behind
a running Start; use the operator Stop above for immediate cancellation/cleanup.
Extend cannot revive an expired or Stopping run. Wait for verified Off, then Start
explicitly if another session is needed.

## Phone invites and revocation

```bash
# Prints IDs only, never codes.
node scripts/test/invites.mjs list --file "$HOME/.called-it-test/owner.json"

# Writes just this invite to another private file; never stdout or a URL.
node scripts/test/invites.mjs export-invite --file "$HOME/.called-it-test/owner.json" \
  --id tester-1 --output "$HOME/.called-it-test/invite-tester-1.txt"
```

Open the private file locally, copy the code through a trusted private channel to the
phone, and paste it into the web app's invite field with a display name. On macOS,
`pbcopy < "$HOME/.called-it-test/invite-tester-1.txt"` copies without printing it.
Share the ordinary app URL separately. Do not paste codes into chat/CI logs, query
strings, screenshots, public bundles or `EXPO_PUBLIC_*` variables.

Each stable tester ID owns a distinct durable unprivileged account. Reuse an ID for
the same person; never give a retired ID to a new person. Manage the local bundle:

```bash
node scripts/test/invites.mjs add --file "$HOME/.called-it-test/owner.json" --id tester-2
node scripts/test/invites.mjs rotate --file "$HOME/.called-it-test/owner.json" --id tester-1
node scripts/test/invites.mjs remove --file "$HOME/.called-it-test/owner.json" --id tester-2
```

**Stop, publish the updated bundle, then Start.** Publication is leased and requires
Idle, so old revisions cannot retain removed testers' configuration. Hash rotation
alone changes future logins, not already issued sessions for that ID. Removing the
ID revokes that tester on the new configuration without deleting historical results.
The backend requires 1..100 active IDs; removing the last invite is rejected. Keep
TEST Off if nobody should have access, or add a replacement before retiring an ID.
See [TEST API behavior](test-api.md) for exact token/revocation and game semantics.

If the local file is lost, recover rather than regenerating keys:

```bash
node scripts/test/lifecycle.mjs recover-secrets --output "$HOME/.called-it-test/recovered-owner.json"
```

## Private database and configuration contract

ARM provisioning does not grant database permissions or apply EF migrations.
`tools/TestDatabase` runs as the migration Job UAMI through the SQL Private Endpoint.
It checks the expected scope/server/database and private DNS, creates the runtime
contained user with an explicit binary SID derived from the ARM **principal/object
ID** and `TYPE=E`, and checks an existing user's SID/type. This avoids Graph display-name
lookup and Directory Readers grants. Only `db_datareader`/`db_datawriter` are granted
to runtime; unexpected roles or DDL/user-management rights fail the deployment.

The migration image bundles EF **10.0.9**'s idempotent script, executes its `GO` batches
on one connection, and exits unsuccessfully on failure. The old root EF tool manifest
is not used. The API never attempts DDL on startup in TEST.

| Environment variable | TEST value/source |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT`, `DOTNET_ENVIRONMENT` | `Test` |
| `ASPNETCORE_URLS` | `http://+:8080` (HTTPS terminates at ACA ingress) |
| `Database__Provider` | `SqlServer` |
| `Database__ApplyMigrationsOnStartup` | `false` |
| `ConnectionStrings__Database` | SQL FQDN/database, TLS certificate validation, Managed Identity authentication, runtime **client ID** |
| `AZURE_CLIENT_ID` | runtime UAMI client ID |
| `Auth__SigningKey`, `Contacts__Pepper` | Versioned Key Vault references |
| `TestMode__Enabled`, `TestMode__RoundSeconds` | `true`, `120` |
| `TestMode__InvitesJson` | Versioned KV JSON array of stable `id` and lowercase SHA-256 `codeHash` |
| `SocialAuth__UseFake` | `false`; ordinary OTP/social login is disabled in TEST |
| `Leaderboards__Provider` | `Database` |

`/health` is anonymous startup/liveness; `/health/ready` reports database connectivity
with 200/503. Startup, liveness and readiness probes are declared in Bicep. Application
logs default to Warning. The container uses a non-root user, 0.25 CPU / 0.5 GiB,
Consumption only, min 0 / max 1 replicas.

`Dockerfile` uses Node 24 to run `npm ci` and `npm run export:web`, then copies
`clients/mobile/dist` into the API's published `wwwroot`. `Directory.Build.props` and
`global.json` are copied before .NET restore in both Dockerfiles. Web keeps
`EXPO_PUBLIC_API_BASE_URL` unset for same-origin API requests. Native iOS/Android
builds, distribution, platform authentication and an explicit native API URL are later
work; this deployment does not produce a native binary.

## Expiry, failure and teardown verification

The authoritative non-secret blob records scope, phase, run ID, stack ID and expiry.
Start/Extend/Stop use a finite 60-second blob lease; long local operations renew it
and abort further requests if renewal fails. The watchdog observes every five minutes,
reacquires the lease, rereads the current run/deadline and claims Stopping before
teardown. A stale observation cannot undo Extend or delete a newer run.

Cleanup validates exact stack ID, ownership tags, resource inventory restricted to
the run RG, deployment scope and `denySettings=none`. It cancels a safely scoped
in-flight ARM deployment when necessary, then deletes only stack-owned resources.
It never falls back to an unrestricted RG/resource deletion.

Off requires both an empty disposable resource inventory and a **404 for the
ACA-managed group** after Azure's own cleanup. The data group is never a deletion
target. An incomplete/failed delete remains Stopping, retries on later watchdog ticks,
and triggers the Owner failure alert. Local failures also record a sanitized state
error. Do not rewrite the blob to Idle or use a stack out-of-sync bypass to hide
leftovers. Inspect Azure deployment-stack operations and Logic App run history;
correct the reviewed IaC/permissions and repeat confirmed Stop.

A provider delete that remains in progress after 20 minutes also causes failed,
alerting ticks without disabling later retries. A second metric alert watches for
missing workflow starts over 15 minutes. Missing metric data or monitoring outages
can still delay/suppress notifications; neither alert is a substitute for verifying Off.

The watchdog and Owner email/budget alerts are safeguards, **not a hard billing
cap or availability guarantee**. Azure outages, missed ticks, deleted/disabled
controllers, permission problems and slow resource teardown can extend charges.
Monitor the first real run and verify Off before walking away.

For first cloud acceptance, run a short test and Stop rather than leaving the default
four hours running. Verify private SQL and the absence of public firewall rules,
successful private migration, phone login/play, and runtime's limited SQL role.
Start again with the same invite; verify the same user/results/boards survived.
Exercise Extend, then explicitly shorten that exact run's deadline:

```bash
node scripts/test/lifecycle.mjs expire --run-id <current-run-id> --confirm <current-run-id>
node scripts/test/lifecycle.mjs status
```

`expire` does not delete resources. Watch the independent workflow claim/complete
Stop, verify all disposable resources and the managed group are gone, and verify
SQL/KV/controller/identities remain. A live cloud exercise is still necessary:
offline Bicep compilation and mocked race tests cannot prove Azure provider capacity,
RBAC propagation, network reachability or the deployed WDL service behavior.

## Cost model and limitations

Approximate public USD retail prices for East US 2, excluding tax/agreements:

| Cost source | Planning estimate |
| --- | --- |
| Retained SQL Basic, 5 DTU / 2 GiB | $0.161/day, approximately $4.90/month |
| Retained watchdog, blob, KV, two metric alerts | Usually below $1/month at this scale; action/request based |
| **Off baseline** | **About $5-6/month**, not zero |
| Disposable external custom-VNet ACA load balancer | $0.025/hour |
| Two ACA-managed Standard public IPv4 addresses | $0.005/hour each |
| SQL Private Endpoint | $0.01/hour, plus traffic |
| ACR Basic while provisioned | $0.1666/day, about $5.07/month if accidentally retained |
| Private DNS | $0.50/zone-month plus queries; check billing granularity for short runs |
| One active 0.25 CPU / 0.5 GiB replica | Approximately $0.027/active hour before shared grants |
| Log Analytics | $2.76/GiB beyond shared allowances; daily cap set to 0.1 GiB |
| KV / built-in Logic App actions | $0.03/10,000 KV operations; $0.000025/action |

Network plus a prorated registry is roughly $0.052/run-hour, plus active app/Job
execution. A four-hour light run is roughly **$0.32 plus DNS, logs, traffic, requests,
build time and teardown time**, on top of the retained monthly baseline. This is an
estimate, not a guaranteed minimum charge: verify ACR/DNS billing granularity and
actual meters after the first Start/Stop. GitHub private-repository runner usage also
has its own plan/allowances.

No shared Container Apps/Log Analytics/Logic Apps/Azure Monitor grant is assumed to
belong exclusively to TEST. The log cap can overshoot and can make logs unavailable
until reset. Deleted logs and Key Vault data have soft-delete/recovery behavior; they
are not a reason to retain a running registry, PE or ACA environment. No paid Defender
SQL plan is enabled by these templates; an existing subscription policy/plan may
nevertheless bill separately and is not silently changed.

The retail catalog also lists an ACA environment-management meter. Current billing
documentation associates it with dedicated profiles, ACA inbound private endpoints
or planned maintenance, none selected here. A SQL Private Endpoint is not an ACA
inbound Private Endpoint. The custom-VNet LB/public-IP costs above **do** apply.
Treat unexpected management meters, SKU/capacity restrictions or private-network
permission failures as blockers; never silently change hosting/region or expose SQL.

The $25 monthly Azure budget filters the data, run **and managed** group names, with
80%/100% actual and 100% forecast alerts to subscription Owner role recipients.
Owners need usable email addresses; group-based role membership and delivery must be
verified. The Pay-As-You-Go subscription's spending limit is Off: the budget sends
alerts and does not stop spend.

References: [Azure retail prices](https://prices.azure.com/api/retail/prices),
[ACA custom VNet charges](https://learn.microsoft.com/azure/container-apps/custom-virtual-networks),
[ACA billing](https://learn.microsoft.com/azure/container-apps/billing),
[SQL identity/SID](https://learn.microsoft.com/azure/azure-sql/database/authentication-azure-ad-user-assigned-managed-identity),
[deployment stacks](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deployment-stacks),
[blob leases](https://learn.microsoft.com/rest/api/storageservices/lease-blob),
[budget notifications](https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets),
[daily log caps](https://learn.microsoft.com/azure/azure-monitor/logs/daily-cap).

## Local validation

```bash
node --test scripts/test/*.test.mjs
node infra/test/watchdog-definition.mjs
az bicep build --file infra/main.test.bicep --stdout > /dev/null
az bicep build --file infra/test/run.bicep --stdout > /dev/null
az bicep build --file infra/test/secrets.bicep --stdout > /dev/null
az bicep build-params --file infra/main.test.bicepparam --stdout > /dev/null
az bicep build-params --file infra/test/run.bicepparam --stdout > /dev/null
dotnet run --project tools/TestDatabase/TestDatabase.csproj -c Release -- --self-test
actionlint -ignore 'SC2129'
docker build --target migration --tag called-it-migrate:local .
docker run --rm called-it-migrate:local --self-test
docker build --target api --tag called-it-api:local .
```

`infra/test/run.bicepparam` is a **compilation fixture only**, never deployment input.
The lifecycle allocates/validates real run IDs and foundation outputs. After changing
the expiry source, regenerate its checked-in definition with
`node infra/test/watchdog-definition.mjs --write`. CI also preserves the .NET suite,
compiles existing dev/prod IaC, runs mobile lint/typechecks/unit tests/web export, and
builds both TEST image targets without publishing them.
The actionlint command suppresses the existing dev/prod scripts' redirect-style
suggestions (`SC2129`), not workflow validation errors.
The published 2016 WDL JSON schema predates managed-identity authentication and uses
older retry-enum casing. The checked-in tests verify the documented modern UAMI
authentication, Blob date/version headers, control depth, references and race guards;
do not remove identity authentication just to satisfy that legacy schema. The first
operator bootstrap must still validate the deployed workflow in the Azure service.
