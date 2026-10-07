# Infrastructure (Azure Bicep)

**On-demand TEST uses a separate entrypoint and lifecycle.** Start with
[`docs/test-deployment.md`](../docs/test-deployment.md): `main.test.bicep` retains private SQL,
keys and a tiny expiry controller; `test/run.bicep` owns disposable ACA/network/registry resources
through a deployment stack. Start is explicit, expiry defaults to four hours, and Stop preserves
accounts/results. There is no TEST SQL password, public firewall exception, or manual database
user prerequisite.

The rest of this page describes the **existing dev/prod** resource-group-scoped deployment.
Do not use its full-platform sizing, SQL grants or manual commands for TEST.
One dev/prod deployment provisions the full platform:

| Concern | Resource |
| --- | --- |
| Compute (API, external ingress) | Azure Container Apps |
| Compute (Workers, no ingress) | Azure Container Apps |
| Container images | Azure Container Registry |
| System of record | Azure SQL Database (serverless) |
| Leaderboards / cache | Azure Managed Redis |
| Media / share cards | Azure Blob Storage |
| SMS OTP | Azure Communication Services |
| Push (APNs) | Azure Notification Hubs |
| Secrets | Azure Key Vault (RBAC) |
| Config / feature flags | Azure App Configuration |
| Observability | Log Analytics + Application Insights |
| Service-to-Azure auth | User-assigned managed identity (+ role assignments) |

All service-to-service auth uses the **shared user-assigned managed identity** — the container apps
pull from ACR, read Key Vault / App Configuration, access Storage, and (recommended) connect to SQL
with **no stored credentials**. Third-party connection strings (Redis, ACS, Notification Hubs) are
materialised as **Container App secrets** at deploy time via `listKeys()`.

## Layout

```
infra/
  main.bicep              # orchestrator (resource-group scoped)
  main.dev.bicepparam     # dev sizing + params (secrets from env vars)
  main.prod.bicepparam    # prod sizing + params (secrets from env vars)
  main.test.bicep         # TEST subscription bootstrap: retained data/identity/controller
  main.test.bicepparam    # TEST operator bootstrap parameters
  test/                   # disposable run stack, secrets, watchdog, shared scope contract
  modules/                # one file per concern
```

## Prerequisites

- An Azure subscription + a resource group.
- The deploying principal needs **Owner** (or Contributor **plus** User Access Administrator) on the
  resource group, because the templates create **role assignments**.
- Secrets provided via environment variables (never committed): `SQL_ADMIN_PASSWORD`,
  `AUTH_SIGNING_KEY` (≥ 32 chars), `CONTACTS_PEPPER`. Optional: `SQL_AAD_ADMIN_OBJECT_ID`,
  `SQL_AAD_ADMIN_LOGIN`, `ACS_FROM_NUMBER`, `API_IMAGE`, `WORKERS_IMAGE`.

## Deploy

```bash
az group create -n called-it-dev -l eastus

SQL_ADMIN_PASSWORD='<strong-password>' \
AUTH_SIGNING_KEY='<32+ char signing key>' \
CONTACTS_PEPPER='<random pepper>' \
az deployment group create \
  -g called-it-dev \
  -f infra/main.bicep \
  -p infra/main.dev.bicepparam
```

Preview changes first with `az deployment group what-if ... `. The CD workflow
(`.github/workflows/deploy.yml`) runs this after building + pushing the images and passes
`API_IMAGE` / `WORKERS_IMAGE`.

## One-time: let the managed identity use SQL (recommended)

After the first deploy, create a contained database user for the managed identity so the apps can
connect without a password. Connect to the database as the Entra admin and run:

```sql
CREATE USER [called-it-<env>-id] FROM EXTERNAL PROVIDER;   -- the UAMI name
ALTER ROLE db_datareader  ADD MEMBER [called-it-<env>-id];
ALTER ROLE db_datawriter  ADD MEMBER [called-it-<env>-id];
ALTER ROLE db_ddladmin    ADD MEMBER [called-it-<env>-id];  -- allows EF Core migrations
```

The API applies the EF Core schema on startup (or run migrations from CI). Until the contained user
exists, switch `ConnectionStrings__Database` to a SQL-auth string using `SQL_ADMIN_PASSWORD`.

Once the contained user exists, set `SQL_AAD_ONLY_AUTH=true` (prod) to disable SQL-auth logins so the
server only accepts Entra identities — this removes the internet-facing admin password as an attack
surface. Do **not** enable it before the contained user is created, or the apps will be locked out.

## Security posture

Baked into the templates:

- **Managed identity** for all service-to-Azure auth (ACR pull, Key Vault, Storage, App Config, SQL) —
  no credentials in code. Key Vault uses RBAC + soft-delete + purge protection; ACR admin user and App
  Configuration local auth are disabled.
- **SQL:** TLS 1.2 floor, optional Entra-only auth (`SQL_AAD_ONLY_AUTH`), and **Microsoft Defender for
  SQL** (`enableDefender`, on by default) for SQL-injection / anomalous-login / exfiltration alerts.
- **Storage:** public blob access off, shared-key auth **disabled** (managed-identity only), HTTPS-only,
  TLS 1.2, and 7-day blob/container soft-delete.
- **Redis (Azure Managed Redis):** TLS-only (Encrypted) client protocol, TLS 1.2 floor, port 10000. **Container Apps:** `allowInsecure:false` (HTTPS ingress).
- **OTP abuse:** SMS sends are rate-limited in the API (per-phone cooldown + hourly/daily caps) to
  defend against SMS-pumping / toll fraud — see `Auth:Otp*` settings.

Recommended next hardening (needs a decision / subscription action — tracked in the manual-setup issue):
**Azure Front Door + WAF** (rate-limit / bot / geo rules), **Microsoft Defender for Cloud** plans,
**Apple App Attest / DeviceCheck** attestation on the OTP + write endpoints, **ACS SMS spend
alerts**, and **Private Endpoints + VNet integration** to set `publicNetworkAccess:'Disabled'` on SQL /
Key Vault / Redis / Storage.

## Notes

- `acsFromNumber` is empty until you purchase an ACS number — until then the app falls back to the
  dev SMS sender (which logs the OTP). Notification Hubs still needs APNs credentials configured
  before real pushes succeed. Both are covered in the repository's manual-setup issue.
- Validate locally without deploying: `bicep build infra/main.bicep` and
  `bicep build-params infra/main.dev.bicepparam`.
