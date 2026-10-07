# On-demand Azure TEST

> **Local-first development:** cloud testing was discontinued at the operator's request
> on October 7, 2026, in favor of a browser-only UI playground. Use
> [`npm run playground`](../clients/mobile/README.md) from `clients/mobile`; it needs no
> Azure resources or invites. The instructions below are retained for a future,
> explicitly approved cloud deployment, not as prerequisites for local development.
> The TEST GitHub identity variable has been removed. Full removal, unlike normal Stop,
> deletes retained SQL data, keys, and the controller. Azure enforces seven-day soft-delete
> retention for the purge-protected vault; a deleted vault name cannot be freshly reused
> during that period without an explicit recovery decision.

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
| Retained control / RG and deployment metadata region | East US 2 (`eastus2`) |
| SQL / disposable workload region | Central US (`centralus`) |
| Persistent group | `called-it-test-data` |
| Disposable group | `called-it-test-run` |
| ACA service-managed group | `called-it-test-managed` |
| GitHub environment | `test` in `CallMeGreg/called-it` |

`infra/test/config.json` is the shared non-secret scope contract. Scripts require an
explicit isolated `AZURE_CONFIG_DIR`, reject a different current subscription/tenant
before mutation, pass `--subscription` on Azure CLI cloud calls, and restrict direct
ARM requests to the approved subscription. They never call `az account set`.
Do not bypass these guards or substitute dev/prod parameter files.

`location=eastus2` preserves existing identities, Key Vault, lifecycle storage,
shutdown workflow/action group, both resource-group metadata locations and named
subscription/deployment-stack metadata. `workloadLocation=centralus` places the SQL
server/database and all regional disposable resources together in Central US.
Private DNS and metric alerts retain their required `global` location. All resource
names and the shared suffix are unchanged; user-assigned identities can be used
across these regions without recreation or new federation.

The original SQL provisioning attempt was denied for this subscription in East US 2
(`ProvisioningDisabled`). Central US was explicitly approved; scripts do not select
an alternate region automatically. SQL capability/name-availability checks do not
reserve capacity or guarantee a successful create.

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
Their East US 2 availability remains a dependency for secret retrieval, lifecycle
state and automatic shutdown. The split is not a multi-region failover design.
Cross-region control/secret traffic can add small latency and bandwidth charges;
SQL queries and the private endpoint stay with the application in Central US.

## IaC and identities

`infra/main.test.bicep` is the subscription-scoped retained foundation. It creates both
groups, identities, OIDC federation, narrow custom roles, SQL, Key Vault, controller
storage, the expiry workflow, Owner notifications, and a filtered monthly budget.
The database, vault and controller storage have `CanNotDelete` locks.

`infra/test/run.bicep` is deployed through one resource-group deployment stack with a
unique random run ID. Its three successive versions are network/registry, migration
Job, then application. Images must be digest-addressed images from that run's ACR.
Every PUT also has a distinct durable submission ID, stamped on both the stack and
the underlying Bicep deployment parameters. Resource-group stack requests contain
`tags` and `properties`, **not top-level `location`**. The request explicitly sets
`properties.deploymentScope` to the exact run RG, `denySettings.mode=none`, and
delete/detach actions. A returned null/omitted deployment scope means that same
stack scope; any explicit different scope is refused. Regional metadata is verified
by reading the owning RG, not by requiring a `location` field in the stack response.
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
to verify run-RG ownership/location and that the service-created ACA group disappears. The deployer cannot read
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

### Retry an incomplete bootstrap

An unsuccessful root deployment can leave owned identities, KV, storage, the
controller and alerts in place without usable foundation outputs or a state blob.
Do not delete their resource group, change the shared suffix, purge/recreate KV,
or move those resources to recover. Before the initial region correction, the
operator confirmed that the exact SQL server resource was **404** and its original
global name remained available; absence of a database alone would not prove that.
An existing SQL server in another region is a separate migration/recovery decision,
not an in-place location update or permission to choose a new name.

With the reviewed split-region revision and the same isolated operator context:

```bash
# Providers are already registered; this reconciles the same owned foundation.
node scripts/test/lifecycle.mjs bootstrap
```

The subscription deployment remains `called-it-test-foundation` in **East US 2**;
changing that deployment's `--location` would conflict with its existing metadata.
The helper explicitly supplies `location=eastus2` and `workloadLocation=centralus`
to Bicep. It retries the deployment **before** requiring outputs, reads outputs only
after success, preserves the existing budget start, and creates state with
`If-None-Match: *`. An existing schema-v2 state blob is read/validated, never reset.
Both Azure's 412 response and its specific 409 `BlobAlreadyExists` response require
that reread; other conflicts or unreadable/invalid state fail bootstrap.
Missing outputs are not replaced with guessed values.

Require the complete bootstrap, dependent RBAC/budget and blob initialization to
succeed before publishing secrets or starting workloads. Until initialization, a
watchdog `Read_state`/`NotFound` failure is expected; do not disable alerts or bypass
heartbeat checks. After success, wait for a healthy five-minute tick. Keep any
already-created owner bundle and publish it as below rather than regenerating keys.

### Configure access and publish invites

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
   its four-hour expiry **before** provisioning paid resources. Before **each** stack
   PUT, validate its exact payload, then persist its submission/client-request IDs,
   submission time and prior deployment generation.
3. Compile/apply the Central US Bicep network/registry stage while keeping stack
   metadata inherited from the East US 2 run RG. Build the migration and API+web images
   on the runner, push to ACR, resolve immutable digests.
4. Apply the Job stage, start one execution inside the VNet, and require success.
   An empty 202 Job-start response is followed through its validated ARM operation URL
   to an execution result, then that execution's status is checked. If both headers
   exist, `Azure-AsyncOperation` is awaited before retrieving `Location`; an operation
   status object's `name` is not assumed to identify a Job execution.
5. Apply the API stage with the agreed settings, require database readiness, a served
   HTML page and its same-origin JavaScript assets, then record Running and print the
   non-secret HTTPS URL/run ID.

Start also verifies the actual SQL server is in Central US and remains
public-network Disabled, the watchdog is in East US 2 with both expected region
parameters, and the phone URL is an HTTPS `*.centralus.azurecontainerapps.io` origin.
Each stage first calls the documented non-provisioning
`POST {exact-stack-id}/validate?api-version=2024-03-01`. It sends the same
`tags`/`properties` payload as the later PUT. A bodyless 202 is polled only through
the validated ARM operation URL, honoring a bounded Retry-After. Validation has a
five-minute deadline and no automatic resubmission; the lease is renewed and expiry
is rechecked before the PUT. Validation failure/timeout creates no new submission
intent and sends no stack PUT. It does not settle any earlier ambiguous PUT.

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

The authoritative private blob records scope, phase, run ID, stack ID, expiry and
a schema-v2 submission ledger. It contains no game data or application credentials,
but may retain a complete signed ARM operation-tracking receipt. Keep raw state and
controller run history private; console Status and error messages omit URL query
metadata. There can be only one unresolved PUT at a time.
Start/Extend/Stop use a finite 60-second blob lease; long local operations renew it
and abort further requests if renewal fails. The watchdog observes every five minutes,
reacquires the lease, rereads the current run/deadline and claims Stopping before
teardown. A stale observation cannot undo Extend or delete a newer run.

**A client timeout or cancellation does not cancel an ARM PUT.** Its intent remains
durable even when the stack is currently 404 and the resource inventory is empty.
Both the CLI and watchdog reconcile pending submissions **before any stack deletion**
and check the ledger again before writing Idle. A terminal, validated ARM LRO receipt
can settle a submission. If that receipt was lost, fallback evidence requires the
submission marker in both stack and associated ARM deployment parameters, changed
stack correlation, a changed deployment ID or deployment correlation, and terminal
states in both. A new tag paired with an old successful generation is not proof.
A statusless 200/204 response alone is not proof either; it still requires the
associated-generation checks.

One narrowly recognized **pre-execution rejection** is also terminal failure:
HTTP 400, `InvalidDeployment`, and the exact message that top-level `location` is
not allowed for this exact stack name at resource-group scope. Only the exact short
message or that message plus the fixed suffix
` Please see https://aka.ms/deploy-to-subscription for usage details.` is accepted;
unknown suffixes are refused. A direct response is reduced to a sanitized receipt
and persisted under the same lease. Error bodies,
credentials and arbitrary messages are not stored. All other 400/500 errors,
timeouts and cancellations remain unresolved; `InvalidDeployment` by itself is
not sufficient evidence.

When no conclusive evidence is available, Stop fails closed in **Stopping**, keeps
the pending record, alerts, and blocks another Start. Status includes the submission
ID, client request ID, any saved operation URL without its query, and prior generation IDs for Azure
deployment/activity-history investigation. Later ticks retry reconciliation and
delete the resulting stack once it is safe. Do not clear the ledger, force Idle, or
treat a quiet interval as proof that a delayed request cannot materialize.
If Azure cannot provide authoritative completion evidence, retain this blocked state
and escalate the recorded identifiers to the operator/Azure support.

Cleanup first GETs the exact run RG and verifies its ID, East US 2 metadata location,
and `called-it`/`test`/`disposable` ownership tags. It then validates exact stack ID,
ownership tags, resource inventory restricted to the run RG, explicit or inherited
same-RG deployment scope and `denySettings=none`. It cancels a safely scoped
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

The CLI understands the stack API's documented lowercase/camelCase states, including
`waiting`, `updatingDenyAssignments` and `deletingResources`; an unknown state is never
treated as permission to delete. Job and stack LRO URLs must stay on the approved ARM
host/subscription and the expected provider/region or run resource scope. Tracking
regional `Microsoft.Resources` stack/deployment LROs uses **East US 2**, matching
their control metadata; regional `Microsoft.App` Job LROs use **Central US**.
Scoped/nonregional operation URLs must still identify the approved subscription,
provider and resource path. The regions are not interchangeable. Tracking
regional LRO endpoints requires resource-group-level permissions, already supplied by
the deployer's Contributor and cleanup identity's read grants, rather than broadening
them to subscription Contributor. Azure CLI tokens are cached independently per
audience only until their actual `expires_on` timestamp minus 60 seconds.

Azure can return signed tracking metadata (`t`, `c`, `s`, `h`) in a stack validation
or deployment LRO URL. The CLI and watchdog accept this exact query shape only on
the approved East US 2 regional deployment-stack operation status/result endpoints,
with the expected API version and bounded URL length. Missing, duplicate, unknown
or reordered parameters fail closed. The opaque receipt is preserved unchanged for
authenticated polling; it is not reduced to a fabricated unsigned URL. This does
not broaden the allowed subscription, provider, resource, or region.

The native create/update async header uses the singular
`deploymentStackOperationStatus` endpoint; it is included explicitly in the shared
CLI/watchdog allowlist, alongside the plural status and result forms.

The signed-receipt-aware controller definition is **2.3.1.0**; durable blob state remains
**schema v2**. Redeploy the matching foundation/controller before Start/Extend.
Both region parameters and the controller version are checked, so the older 2.3.0.0
definition is not accepted for a new launch. Existing schema-v2 state is preserved;
schema-v1 blobs/writers are still rejected, not silently upgraded, because they may
have unrecorded in-flight requests.

### Recover a lost validation-rejection receipt

Use the updated scripts in the same isolated **human operator** Azure CLI context.
This command is deliberately unavailable to GitHub workflow identities and accepts
no local event JSON. It requires the exact Stopping run, pending submission UUID and
Azure Activity `eventDataId` from the failed PUT's EndRequest event:

```bash
node scripts/test/lifecycle.mjs reconcile-rejection \
  --run-id <blocked-run-id> \
  --submission-id <pending-submission-uuid> \
  --event-id <azure-activity-event-data-uuid>

# Reconciliation retains Stopping; normal inventory/managed-group checks are required.
node scripts/test/lifecycle.mjs stop --run-id <blocked-run-id> --confirm <blocked-run-id>
node scripts/test/lifecycle.mjs status

# After verified Off, install the matching controller; do not reset the state blob.
node scripts/test/lifecycle.mjs bootstrap
```

The helper fetches evidence itself from the authenticated, documented Activity Logs
List API using the exact subscription/resource and a bounded submission-time window.
It verifies event/resource/entity/request URI, operation, PUT method, exact pending
client-request ID, EndRequest/Failed/BadRequest/statusCode, and the single allowed
error code/message. Event time must be between the recorded submission time and five
minutes later, and not in the future. This is a strict evidence-association bound,
**not a quiet-period heuristic**. Scoped pagination is bounded to ten pages.
An absent, stale, foreign, conflicting-LRO or unrecognized event leaves intent
unresolved. Log ingestion can be delayed; absence never authorizes clearing state.

Under a renewed lease it rereads the exact run/submission before recording only that
intent as failed, with sanitized event/correlation IDs and timestamps. It never
deletes resources or writes Idle. The old controller safely treats the new receipt
as unresolved until the updated operator Stop verifies teardown; upgrading the
controller is therefore done afterward while Off. Wait for the matching controller's
healthy five-minute heartbeat before the next Start. If the immutable evidence is
unavailable or does not meet every check, keep Stopping and escalate; there is no
force-clear command.

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

Public USD retail unit rates checked **2026-10-07**, excluding tax/agreements.
Central US is the workload region; retained controls remain in East US 2. Some
network/DNS meters have a global catalog rate, not a different resource location.

| Cost source / retail meter | Rate catalog | Planning estimate |
| --- | --- | --- |
| Retained SQL Single Basic, `B DTU`, 5 DTU / 2 GiB | Central US | $0.161/day, approximately $4.90/month |
| Retained KV, `Operations` | East US 2 | $0.03/10,000 operations |
| Retained Logic Apps, `Consumption Built-in Actions` | East US 2 | $0.000025/trigger or action beyond shared allowance |
| Two retained Azure Monitor `Alerts Metric Monitored` series | East US 2 | $0.10/series-month beyond shared allowance; $0.20 for two |
| **Off baseline after complete bootstrap** | Split regions | **Budget $6-7/month before shared grants**, including tiny blob usage; not zero |
| Disposable Standard load balancer, included LB/outbound rules | Global meter | $0.025/hour plus $0.005/GB processed |
| Two ACA-managed Standard IPv4 Static Public IPs | Central US | $0.005/hour each |
| SQL `Standard Private Endpoint` | Global meter | $0.01/hour plus $0.01/GB ingress/egress at the first traffic tier |
| ACR `Basic Registry Unit` | Central US | $0.1666/day, about $5.07/month if accidentally retained |
| Private DNS zone / queries | Global meter | $0.50/zone-month plus $0.40/million queries; check short-run granularity |
| ACA Standard vCPU / memory active usage | Central US | $0.000024/vCPU-second + $0.000003/GiB-second; $0.027/hour for 0.25 CPU / 0.5 GiB |
| ACA Standard Requests | Central US | $0.40/million beyond shared allowance |
| Log Analytics, `Analytics Logs Data Ingestion` | Central US | $2.76/GB beyond shared allowance; daily cap 0.1 GB |

A healthy Idle tick executes four built-in actions plus the recurrence trigger.
At one tick every five minutes, allow roughly $1.08 per 30 days before shared
Logic Apps grants, plus up to $0.20 for the two alert series and small blob/KV usage.
The more conservative Off estimate includes these controls; the location split adds
no new always-on service. More active/reconciliation ticks can cost more.

The catalog identifies the selected SQL meter as `cae64797-9ecf-4906-b517-6238c80c045f`,
ACR Basic as `5c9e7a65-5784-494c-9718-7749d4075dd9`, the Standard LB rule meter as
`27827eb0-7f60-4928-940b-f5fe15e7a4cb`, and the Standard PE as
`e6ab7238-e433-4fe0-a2b2-2b2564df2cdb`. Match the region, SKU and tier as well as
the meter ID when refreshing rates; global and regional entries can share an ID.

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
[RG stack request contract](https://learn.microsoft.com/rest/api/resources/deployment-stacks/create-or-update-at-resource-group?view=rest-resources-2024-03-01),
[RG stack preflight validation](https://learn.microsoft.com/rest/api/resources/deployment-stacks/validate-stack-at-resource-group?view=rest-resources-2024-03-01),
[Azure CLI native RG-stack response recording](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/resource/tests/latest/recordings/test_create_deployment_stack_resource_group.yaml),
[Activity Logs List/filter contract](https://learn.microsoft.com/rest/api/monitor/activity-logs/list?view=rest-monitor-2015-04-01),
[ARM asynchronous operations and permissions](https://learn.microsoft.com/azure/azure-resource-manager/management/async-operations),
[blob leases](https://learn.microsoft.com/rest/api/storageservices/lease-blob),
[budget notifications](https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets),
[daily log caps](https://learn.microsoft.com/azure/azure-monitor/logs/daily-cap).

Region/retry references:
[deployment name/location binding](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-to-subscription#deployment-location-and-name),
[resource-group metadata locations](https://learn.microsoft.com/azure/azure-resource-manager/management/manage-resource-groups-portal#what-is-a-resource-group),
[cross-region user-assigned identities](https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/managed-identities-faq#can-the-same-managed-identity-be-used-across-multiple-regions),
[private endpoint region requirements](https://learn.microsoft.com/azure/private-link/private-endpoint-overview).

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
