# Azure deployment foundation (opt-in, not launch-ready)

This is the **first local deployment-foundation slice**, not a deployed platform.
Compilation and mocked deployment tests do not prove Azure SKU/region capacity,
quota, price, identity permissions, network access, schema correctness or runtime
readiness. A created foundation is still not a usable application.

The owner-approved Azure **planning envelope is USD 100-250/month**, excluding SMS
and store fees. Nothing here establishes that the proposed warm SQL/compute fit
that envelope. A current named-region/SKU quote, subscription checks and an owner
over-budget/teardown plan are required before any paid operation. Do not cycle
regions to discover capacity by provisioning.

Product decisions and release blockers live in the
[blueprint](../docs/README.md), [architecture](../docs/architecture.md),
[operations](../docs/operations.md), [delivery plan](../docs/delivery-plan.md)
and [platform evidence](../docs/platform-evidence.md). Read them before enabling
any deployment gate. A healthy API is **not** proof of a playable or public release.

## Separation and actual resources

| Entry point | Responsibility |
| --- | --- |
| `main.bicep`, `main.dev.bicepparam`, `main.prod.bicepparam` | Foundation only. There are **no Container App resources or image parameters**, so incremental foundation convergence cannot replace live app images/revisions. |
| `application.bicep` | Two apps in the existing foundation. Explicit immutable image pair, versioned secret references, audiences and fresh revision suffix required. No infrastructure bootstrap or schema migration. |
| `scripts/deploy.py` | Shared local preflight, explicitly requested what-if/apply, image build after ACR exists, and rollout verification. No cloud commands without `--execute`; no paid mutation without `--apply` and approval gates. |
| `scripts/validate.py`, `tests/` | Python standard-library tests and standalone Bicep compilation with non-secret fixtures. No Azure login, queries, Docker build/push or HTTP calls. |
| `.github/workflows/deploy.yml` | All pushes and the default manual `plan` are local-only. Manual non-plan phases on `main` must pass protected-environment approval and the same preflight before OIDC login. |

Foundation resources, identical cost hypotheses for both environment names:

| Resource | Actual default / limitation |
| --- | --- |
| User-assigned managed identity | Shared beta API/worker identity. `AcrPull` on this registry and Key Vault Secrets User on this vault. **No database user or database role is created.** |
| ACR | Basic, admin credentials disabled, registry RBAC mode `LegacyRegistryPermissions`. No registry build tasks, image cleanup or automatic push-role assignment. |
| Azure SQL | Entra-only logical server with a required named Entra admin; General Purpose serverless `GP_S_Gen5_1`, maximum 1 vCore, minimum 0.5, **auto-pause disabled (`-1`)**, 5 GiB maximum storage. Local backup redundancy, seven-day short-term retention, no zone redundancy. These are hypotheses, not measured sizing or an affordable quote. |
| SQL network | Public endpoint enabled but **no firewall entries by default**; no `0.0.0.0` allow-all-Azure rule. Runtime is intentionally blocked until an approved reachable network path exists. No private endpoint, VNet or stable NAT egress is implemented. |
| Key Vault | Standard, RBAC, soft-delete (seven days), purge protection, public endpoint. Created empty. Secret values are populated separately by an authorized owner. Public endpoint exposure/reachability requires review; this is not a private-network design. |
| Log Analytics | Container/platform logs, 30-day retention, 0.1 GB/day configured ingestion cap. Enforcement delay and excluded data mean this is **not a hard spend cap**. No alerts/budget resource or full application instrumentation is implemented. |
| Container Apps environment | Consumption workload profile, logs connected to this workspace, single region, `zoneRedundant=false`. No apps until the separate application phase. |

The application phase creates one API and one worker, each **0.25 vCPU / 0.5 GiB**.
API defaults are min **1**, max **2** replicas and HTTP concurrency target **20**.
Preflight/template bounds permit 1-3 API replicas and concurrency 1-100; min must
not exceed max. The non-HTTP worker has explicit min **1**, max **1**, no ingress,
no HTTP probes and no HTTP scaler. It remains an idle/warm process while all three
scheduled features are disabled; it is not scale-to-zero or an active game engine.
Single replica configuration does not prevent old/new worker revisions overlapping.

Only the API receives startup/liveness `/health/live` and readiness `/health/ready`
probes on port 8080, with HTTPS external ingress and bounded reactive HTTP scaling.
Readiness timeout is ten seconds to accommodate the runtime's bounded SQL probe.
The runtime retains `/health` for compatibility; deployment verification uses the
new routes. No HTTP health endpoint is invented for the worker.

Redis, ACS, App Configuration, Blob Storage/share rendering and their old modules,
secrets and environment variables are removed from this baseline. Front Door
Premium, Service Bus/Event Grid, AI, multiregion and other HA uplift remain deferred.
No App Insights component, connection-string-only SDK claim or Dapr wiring remains.
Adding telemetry SDKs, alerts, secure networking, two warm API replicas or zones is
a separately quoted/tested change. A `prod` resource name does not imply HA.

### Optional push and disabled verification

No Notification Hubs resource is provisioned. `Push__Provider=Disabled` by default.
The optional `NotificationHubs` integration consumes an **existing separately
owned, intentionally configured hub** and its credential in this foundation's Key
Vault. Its cost, APNs/FCM v1 setup, native entitlements, device validation, credential
rights/rotation and eventual installations workflow are separate owner work.
This slice neither creates nor reconverges the hub, avoiding accidental removal of
credentials maintained outside this template. Incomplete or stray disabled-provider
configuration is rejected.

`Sms__Provider=Disabled` always. No ACS resource, number purchase or legacy ACS
configuration is offered by this IaC. Microsoft announced ACS SMS retirement on
September 30, 2028 and new-customer restrictions from October 23, 2026; see the
official sources in [platform evidence](../docs/platform-evidence.md). The allowed
new managed verification supplier has **not** been selected or implemented.
Disabled features fail explicitly (503) in the guarded runtime, never through
development logging or a successful fake send. Mandatory phone onboarding is
therefore not usable; this is an internal foundation, not a beta launch.

## Local validation (safe default)

Requirements: Python 3.10+ and Bicep **0.48.1**. CI sets up that pinned compiler
without Azure login; local validation does not install Azure CLI or use it.
Use an existing standalone Bicep executable:

```bash
python3 infra/scripts/validate.py --bicep /absolute/path/to/bicep
python3 infra/scripts/deploy.py --phase plan
```

The suite builds `main.bicep`, **both** parameter files and `application.bicep`
without warnings. Compilation fixtures live in `tests/test_templates.py`: a
deliberately non-region location, a non-admin object ID and no secrets. Missing
required parameter environment values are also tested as failures. Generated
templates stay in memory; execution-only temporary parameter files are removed.

Tests check resource allowlists, the deployed runtime contract, replica/probe
bounds, image preservation, pre-login validation, image build ordering and mocked
rollout failures. Azure CLI, Docker and HTTP commands in execution tests are
**mocks**, not provider/CLI compatibility or successful deployment evidence.
`actionlint .github/workflows/ci.yml .github/workflows/deploy.yml` can additionally
check workflow/shell syntax when that tool is installed.

`--check` performs local preflight only. `--check --apply` checks paid-operation
approval/input requirements **without logging in or issuing any Azure command**.
Missing inputs return nonzero with an actionable error. Never use compilation
fixtures as deployment settings or bypass preflight with direct template commands.

## Owner setup and permissions (not performed)

Create/select a dedicated resource group only after the owner has approved the
subscription, region, provider registrations, service/SKU support, quotas, policy,
network exception/design, estimate, backup/recovery limitations and resource
teardown ownership. The workflow never creates a resource group or registers
providers. Budget/forecast alerts (50/80/100 percent) and a responder are manual
gates; budget alerts do not stop spend.

Preflight currently targets public Azure endpoint suffixes; sovereign-cloud
deployment would require a separately reviewed change.

Configure GitHub environments **`dev` and `prod`**, each with required reviewers,
prevent-self-review where available, a `main` deployment-branch policy, and
restricted bypass. If the repository/account cannot enforce these controls,
deployment stays disabled. The workflow's `environment:` declaration and
acknowledgment variable do **not** create or prove protection rules.

Use environment-scoped Entra OIDC federation (for example,
`repo:CallMeGreg/called-it:environment:dev`, with the standard Azure token-exchange
audience). There is no long-lived Azure client secret. The workflow requests
`id-token: write` only in the explicitly selected Azure job, after local validation.

| Principal / phase | Required access and boundary |
| --- | --- |
| Foundation deployer | Resource management in the selected group (typically Contributor), **plus separately delegated role-assignment authority** for the two specified runtime grants. Prefer constrained Role Based Access Control Administrator assignments rather than unconditional Owner. Contributor alone cannot create these role assignments. Subscription/provider/Entra administration is not supplied by group-scoped Contributor. |
| Image publisher | Read the successful foundation deployment/registry; explicit **AcrPush** at this RBAC registry's scope. Contributor is **not** an unconditional ACR data-plane push grant. The foundation grants only runtime AcrPull, not publisher push access. ABAC registry mode requires different repository roles and is rejected by this slice. |
| App deployer | Deployment/Container App write plus reads of the foundation, registry and SQL settings, and permission to assign the existing UAMI. Narrow role scopes as practical; managed-identity assignment may require Managed Identity Operator when resource-management scopes are narrowed. Digest existence checks also need registry data-plane read. No SQL DDL or Key Vault secret-value reads are needed by the rollout script. |
| Runtime UAMI | Registry pull, Key Vault Secrets User and separately provisioned SQL contained-user DML grants. No role-assignment capability or SQL schema ownership. |
| Database/secret owners | Separate Entra admin/migrator and Key Vault secret-publisher permissions. Do not make the runtime a migrator or give it secret-management rights. |

The workflow uses one configured OIDC client per environment. Its permissions are
the union needed for the phases it may run, not an automatic least-privilege
separation; restrict/remove bootstrap role-assignment privileges when not needed.
Separate publisher/deployer identities are a future workflow hardening choice.
RBAC propagation, Key Vault reachability and actual data-plane rights still need
owner verification.

## Workflow inputs and environment variables

Manual inputs are `environment` (`dev` default), `phase` (`plan` default), `apply`
(`false` default), `api_image` and `workers_image`. A push can **never** select a
cloud phase, regardless of gate variables. A manual non-plan phase on any ref
other than `main` is not eligible. A manual plan remains local even when enabled.

Set the following as protected **environment variables**, not source defaults:

| Variables | Meaning / when required |
| --- | --- |
| `AZURE_DEPLOY_ENABLED=true`, `AZURE_ENVIRONMENT_APPROVAL_CONFIGURED=true` | Required even for manually selected cloud what-if. Set only after actual environment/OIDC protection exists. Missing values fail before login. |
| `AZURE_COST_APPROVED=true`, `AZURE_FOUNDATION_APPROVED=true` | Required for **any** `apply=true` phase, including image pushes. Acknowledge reviewed resources, network/capacity/region/SKU evidence and current cost; not evidence manufactured by the script. |
| `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_RESOURCE_GROUP` | Required for all cloud phases. The script checks the active account's subscription/tenant before proceeding. IDs are not passwords. |
| `AZURE_LOCATION`, `SQL_ENTRA_ADMIN_OBJECT_ID`, `SQL_ENTRA_ADMIN_LOGIN` | Required for foundation. No empty fallback. The admin must be an authorized, verified Entra principal. |
| `AZURE_NAME_PREFIX`, `SQL_ENTRA_ADMIN_PRINCIPAL_TYPE`, `SQL_ALLOWED_CLIENT_IPS` | Optional foundation settings, default `calledit`, `Group`, `[]`. Prefix: 3-10 lowercase alphanumeric characters starting with a letter. Admin type: `Group`, `User`, `Application`. IPs: JSON array of at most 32 distinct individual public IPv4 addresses; no ranges/CIDRs/allow-all-Azure. |
| `AUTH_SIGNING_KEY_SECRET_URI`, `CONTACTS_PEPPER_SECRET_URI` | Application: exact **versioned** `https://<foundation-vault>.vault.azure.net/secrets/<name>/<32-hex-version>` references. Values are not passed to the workflow/template. |
| `SOCIAL_AUTH_APPLE_AUDIENCE`, `SOCIAL_AUTH_GOOGLE_AUDIENCE` | Required application audiences for real provider token validation. No fake/token bypass. |
| `SQL_BOOTSTRAP_APPROVED=true`, `APPLICATION_ROLLOUT_APPROVED=true` | Application apply only: attest the separate DB/network/schema/seed gate and the reviewed runtime image/security/provider-disabled state. **Not a declaration that unresolved release work is complete.** |
| `API_MIN_REPLICAS`, `API_MAX_REPLICAS`, `API_HTTP_CONCURRENT_REQUESTS` | Optional app settings, default 1, 2, 20 within the bounds above. Worker bounds remain exactly 1/1. |
| `PUSH_PROVIDER` | `Disabled` default, or intentionally `NotificationHubs`. No Development provider allowed. |
| `NOTIFICATION_HUB_NAME`, `NOTIFICATION_HUB_CONNECTION_SECRET_URI`, `PUSH_CONFIGURATION_APPROVED=true` | Required to apply enabled push. Both config values must be absent while push is disabled. URI must be a versioned secret in this foundation vault, containing the separately managed hub connection string. |

The workflow supplies build `IMAGE_TAG=<full commit SHA>-<run ID>-<attempt>` and
application `APPLICATION_REVISION_SUFFIX=r<run ID>-<attempt>`. The script requires
these for their phases. Every app rollout, including rollback and secret-reference
rotation, gets a fresh revision suffix; this avoids silently updating app-scoped
secret references without restarting containers. Existing revision names are
checked before apply; a reused suffix is rejected.

Template sizing parameters are intentionally visible in both foundation parameter
files: `sqlMaxVcores=1`, `sqlMinVcores='0.5'`, `sqlAutoPauseDelay=-1`,
`sqlMaxSizeGb=5`, `logDailyCapGb='0.1'`. The main template bounds allow max vCores
1/2, minimum 0.5/1, max storage 5/10/20/32 GiB and log caps 0.1/0.5/1 GB.
The optional `sqlAutoPauseDelay=60` is for disposable foundations only; application
rollout rejects it and rechecks the **live** SQL database is Online with `-1`.
Edit/review parameter files deliberately to change these hypotheses; no automatic
SKU escalation, multi-region fallback or Defender plan purchase is implemented.

## Ordered first deployment (still blocked)

1. **Review, authorize, then preview foundation.** Leave all gates disabled until
   the owner prerequisites above exist. Run local validation. After configuring
   approvals, select manual `phase=foundation`, `apply=false`: this logs in only
   after preflight and runs Azure what-if, not create. Review the exact target,
   resource changes, provider errors and estimate; an executable template is not
   authorization.
2. **Apply foundation separately.** With owner approval, rerun `foundation` with
   `apply=true`. The incremental deployment is named `calledit-<env>-foundation`.
   Its non-secret `foundation` output records environment/group, registry, UAMI
   IDs, vault, SQL, Container Apps environment and planned app names. It deploys
   **no apps**, performs no migration and publishes no images.
3. **Provision network, database principals/schema and secrets out of band.**
   Complete the gates below. Do not replace a missing network path with an
   allow-all-Azure SQL rule. This Consumption environment has no promised stable
   egress; a reachable restricted/private topology may require a separately
   reviewed infrastructure change and quote before rollout is possible.
4. **Build an approved runtime image pair.** After the ACR exists and explicit
   publisher rights propagate, select `build-images`, `apply=true`. The script
   reads a successful matching foundation deployment and actual ACR before login,
   Docker build or push. It builds Linux/amd64 images on the runner from the
   existing Dockerfiles, pushes unique full-SHA/run tags, then resolves and prints
   **digest references**. It does not deploy them or tag `latest`. A build does not
   prove runtime safety, reproducibility, schema compatibility or deployment.
5. **Preview application explicitly.** Supply both digest references as manual
   inputs with `phase=application`, `apply=false`. Missing images/audiences/secret
   URIs fail locally before login. After login, it checks the foundation belongs
   to this group/environment, the registry/mode, live warm SQL, unused revision
   suffix, same-vault secret URIs and both manifests, then runs application-only
   what-if.
6. **Apply only after the remaining gates are genuinely met.** Review both exact
   images, the matching schema, new revision/config, provider-disabled behavior,
   network exceptions and outstanding security/gameplay limitations. Set the
   required application gate acknowledgments and rerun with `apply=true`.
   Both desired revision names/images must be running/ready in the control plane;
   API `/health/live` and `/health/ready` must return exactly HTTP 200 over HTTPS.
   Redirects, failure, stale revisions and timeouts fail the job with **no success
   summary**. Worker readiness is process/control-plane status only, never proof
   of durable scheduling or successful game work.

`build-images` with `apply=false` only checks foundation/ACR availability: no
registry login, build or push. No phase combines infrastructure, build and rollout.
Compilation, cloud what-if, foundation apply, image publication and app readiness
are distinct results with distinct evidence.

### Non-optional Entra SQL user/schema/seed gate

Azure RBAC does not create database users or grant SQL access. Entra-only auth can
be configured at server creation; there is no SQL password fallback to work around
a missing contained user.

After foundation exists, a database owner must establish and record all of:

- An approved administrative network path and successful Entra admin connection
  **to the application database**, not just `master`. Creating external principals
  may require separately authorized directory lookup permissions/server identity;
  this template does not grant tenant-wide directory roles.
- A contained user mapped to the exact runtime UAMI principal, plus only the
  necessary application-object DML grants. A managed identity client ID in a
  connection string is not this grant. Test positive operations and confirm
  runtime cannot create/alter/drop schema or manage permissions. Do **not** grant
  runtime `db_owner`, `db_ddladmin`, or migration/schema ownership.
- A **separate migrator/bootstrap principal** and reviewed SQL Server-compatible
  schema, migration history, required categories/seed data and rollback-compatible
  version. No migrator lifecycle/schema script is supplied by this slice; existing
  prototype migrations are not proof they work against Azure SQL.
- A successful read-only critical schema/projection/category-seed probe and
  least-privilege runtime connection from the selected deployment network, without
  using privileged administrator credentials.

Both guarded deployed hosts perform read-only critical checks and stop on failure.
Neither host applies startup DDL or seeds outside Development. Do not enable
`SQL_BOOTSTRAP_APPROVED` until the separate lifecycle exists and has been exercised.
This is a current **rollout blocker**, not an informational setup suggestion.

### Key Vault population, reachability and rotation

An authorized secret owner, not the runtime or this rollout script, populates the
empty vault. Required values are a strong non-placeholder signing key (at least
32 UTF-8 bytes, as enforced by the runtime) and a server-held contacts/identity
pepper. Optionally store the scoped existing-hub credential. Never print secret
values, put them in workflow parameters, commit them or expose the pepper to clients.

The UAMI's Key Vault Secrets User role, propagation and network access must allow
Container Apps to resolve each enabled exact version; disabled/deleted/expired
versions fail deployment/startup. A versioned URI is not evidence that its value
exists, is strong or is reachable. Managed identity covers registry pull, vault
reads and SQL authentication; vendor/hub credentials and JWT keys are still secrets.

For an approved credential/signing-key rotation, create a new vault secret version,
record the old/new references privately, update the environment URI and preview/
apply a new application revision with the **same approved image digests** if code
has not changed. The fresh suffix forces a restart; verify both revisions and API
health, then retire the old version only after the rollback/overlap plan allows.
Signing-key changes can invalidate existing sessions; key-ring overlap is not
implemented here. **Do not casually rotate the contacts pepper**: existing phone/
contact identity hashes depend on it. Its rotation needs a separately designed,
tested data/identity migration and recovery plan, not merely a new URI.

## Redeploy, rollback and first-deploy limits

Reapplying foundation cannot reset apps to a placeholder because apps are absent
from that template. Application redeploys must always supply both explicit digests;
reusing the approved pair preserves images while changing reviewed configuration.
Readiness also checks the new revision suffix, so an already healthy old revision
cannot pass as the requested rollout.

Record a release manifest with both digests, versioned secret references, audiences,
replica settings, revision names and compatible schema version before change.
Container Apps single-revision mode gates API traffic on readiness, but this is
not an atomic two-app transaction or a zero-downtime promise. A worker/app update
can succeed while the other fails, and worker executions can overlap.

There is **no automatic rollback**. Inspect the failed revision and whether the
previous API revision is actually still serving. To roll back, run the application
phase with the recorded previous image pair and compatible configuration/secret
versions, a **new** suffix (automatically supplied by the new workflow run), and
the same approvals/verification. Never downgrade the database automatically.
Expand/contract schema compatibility and data recovery are separate owner gates.
On a first rollout there is no previous healthy revision to restore: leave the
service unavailable, fix prerequisites, and retry; never deploy a hello-world image
or fake adapter to make health green.

This is **incremental**, not complete-mode deployment or a deployment stack:
removing modules/array entries does not remove pre-existing standalone resources
(including old SQL firewall rules). It does not reconcile or delete an earlier
prototype's Redis/ACS/storage/hubs, paid Defender plan or permissive firewall
settings. Do not point it at old prototypes as a migration shortcut; adoption,
network-rule revocation and resource teardown require a separate explicit plan.
Previously unmerged prototype branches are preserved, not consolidated here.

The release remains blocked on schema/migrator/network/secret verification, the
real phone supplier, privacy/security/identity controls, competition/outbox/provider
correctness, licensed feeds, measured load/restore/cost and both native clients.
Approval flags acknowledge reviewed prerequisites; setting them is not evidence
that these outstanding requirements have been implemented.
