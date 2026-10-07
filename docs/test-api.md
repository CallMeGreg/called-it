# Invite-only TEST API

The phone-playable POC uses the same scoring engine and persistence as the ordinary game.
Only explicitly enabled TEST mode replaces phone/social login and daily drops. TEST questions
are labeled **TEST SAMPLE - SIMULATED**; their results are random simulations, not real events.

## Configuration

| Setting / environment variable | Contract |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT`, `DOTNET_ENVIRONMENT` | Set both to `Test`. Enabled TEST mode only permits exactly `Test` or `Development`; all other environments fail startup. |
| `TestMode__Enabled` | `true` for the private POC; defaults to `false`. |
| `TestMode__RoundSeconds` | `120` (default and the only supported POC duration). |
| `TestMode__InvitesJson` | JSON array of `{ "id": "...", "codeHash": "..." }`. Enabled mode requires 1-100 entries. IDs must be unique, 1-64 lowercase letters/digits/`-`/`_`. Hashes must be unique lowercase SHA256 hex of the exact UTF-8 invite. |
| `Auth__SigningKey` | A strong private signing key, at least 32 characters. Keep it stable across revisions so sessions survive restart. |
| `Database__Provider` | `SqlServer` for Azure; `Sqlite` for local tests. |
| `ConnectionStrings__Database` | SQL connection string using the configured managed identity in Azure. |
| `Database__ApplyMigrationsOnStartup` | Defaults to `true`, preserving normal startup. Set `false` for least-privilege Azure runtime after the deployment migration phase. |
| `Leaderboards__Provider` | `Database` for the Redis-free POC. Also supports `Redis` (requires `ConnectionStrings:Redis`) and `InMemory`. When unset, the existing Redis-if-configured, otherwise in-memory behavior remains. |

Generate each invite from at least 128 bits of cryptographic randomness; 32 random bytes encoded
as base64url are recommended. Length checks cannot verify entropy. Never put raw invites in source,
configuration, command arguments, URLs, or logs. Only the hashes belong in the secret configuration.
Do not reuse signing keys, invites, or the TEST database for production.

An invite's non-secret ID (for example `tester-1`) is its durable account key. Display names are
not identity keys. Changing the code hash rotates the login credential without losing that
account's history. Removing the ID denies its login, existing access tokens, and refresh tokens
on the revised server. Remove traffic from old revisions to finish revocation: each revision
uses its own startup configuration. Rotating only the hash does not revoke existing sessions.

## HTTP contract

`clients/shared/openapi.yaml` describes the DTOs, including enum casing.

- `POST /api/test/login`: `{inviteCode, displayName}` returns the existing `AuthResult`.
  Invites are compared in constant time against every configured SHA256 hash. Codes must be
  32-256 characters without whitespace. Display names are trimmed, nonblank, at most 60
  characters, and may not contain control characters. The body limit is 4096 bytes.
  Invalid invites return **403**, invalid fields **400**, unavailable mode **404**.
- Login is limited to **20 attempts per remote IP per five-minute process-local window**,
  returning **429** ProblemDetails with no queue. The limiter deliberately does not trust
  arbitrary forwarded headers. Clients behind the same ingress/NAT may share a bucket.
  Restarting resets this defense; it supplements strong random secrets rather than replacing
  them. No distributed rate-limit service is required for this private, one-replica POC.
- `POST /api/auth/refresh`: existing `{refreshToken}` and `AuthResult`, with single-use rotation.
  TEST rotation is serialized in the database. Invalid, revoked, expired, or wrong-mode tokens
  return **403**. TEST access tokens and refresh tokens cannot authenticate in ordinary mode,
  nor can ordinary tokens authenticate in TEST mode.
- `GET /api/test/game`: authenticated `{serverTimeUtc, currentRound, previousRound, stats}`.
  `currentRound` is always a `DailySetView`; `previousRound` is the most recent completed
  `DailySetView` or null. `stats` contains `totalScore`, `overallStreak`, and category
  `{categoryCode, categoryName, currentStreak, bestStreak, totalCorrect}` rows.
  Picks/skips are scoped to the caller. Outcomes use `Unresolved`, `SideA`, `SideB`, or `Void`.
- `POST /api/guesses`: unchanged `{questionId, pick: "A" | "B" | null, skip}`.
  Either pick or skip is required, never both. The server rejects new or changed guesses
  **at or after** `locksAtUtc` with **423**, title `Submission window closed`.
- `GET /api/leaderboards?type=TotalScore&scope=Global` retains `LeaderboardResult`.
  Category boards use the existing query parameter **`category`**, not `categoryCode`.
  Database mode queries durable `Scores`/`Streaks`, includes zero-score registered accounts,
  orders by descending score then user ID, and reranks friend subsets from 1.

Ordinary OTP/social login is forbidden while TEST mode is enabled: there is no console-OTP or
fake-social fallback. TEST users have no phone, phone hash, federated login, contact
discoverability, or admin privilege. Unique indexes and a user identity check constraint prevent
an invite from becoming a phone-backed or admin account. Ordinary daily sets and TEST rounds
are flagged and excluded from each other's scoring, submissions, and leaderboard namespaces.

## Durable request-driven rounds

A game read takes an exclusive database-row lock inside a transaction. If the current round
has expired, it draws one random simulated result per question, persists those outcomes,
replays real scores, and marks the round complete. It then creates one new round at the current
server time. No worker, always-on timer, or backfilled idle rounds is used.

Login, refresh rotation, guesses, and game transitions use the same gate. This works across
processes and overlapping revisions, not just one in-process semaphore. A filtered unique
index additionally permits only one published TEST round. Outcomes, scores, and the new
round commit together; failed requests roll back. The upcoming result does not exist before
lock and is not sent in the game response.

Production eligibility remains `CreatedAt <= DropAtUtc`. TEST replay additionally includes a
round in which a late-registering account submitted a pick or skip; it does not replay rounds
from before account creation with no participation. Correct answers grow that category's
streak and lifetime total; wrong/missed answers reset its streak; skip preserves it. Lifetime
totals and best streaks remain intact through missed rounds.

## Schema deployment and web hosting

Use .NET SDK 10 and **dotnet-ef 10.0.9**, matching the EF package versions. Migrations target
SQL Server through `AppDbContextFactory`. A deployment identity with DDL rights applies an
idempotent migration script before runtime startup:

```sh
dotnet-ef migrations script --idempotent \
  --project src/CalledIt.Infrastructure --output /secure/path/called-it.sql
```

The TEST schema migration is `20261007031337_AddIsolatedTestRounds`. With
`Database__ApplyMigrationsOnStartup=false`, SQL startup verifies that no migrations are
pending, then performs only seed DML under the TEST gate. The runtime identity needs database
reader/writer permissions, not DDL/admin permissions. The migration seeds the singleton gate.
Reverting this migration fails while TEST data exists instead of reclassifying it as production
data. Explicit data handling is required before schema rollback.

SQLite uses `EnsureCreated` for local/test databases; it does not upgrade an older SQLite
schema. Use a fresh local TEST database, or arrange an explicit data migration rather than
expecting `EnsureCreated` to modify existing tables.

Copy the Expo web export to the API's published `wwwroot`. The API serves the index and assets,
with extensionless GET/HEAD SPA routes falling back to `index.html`. Unknown `/api/*`,
`/health/*`, missing assets, and non-GET/HEAD routes do not become successful HTML.
The server can run as a Linux non-root user on port 8080 (`ASPNETCORE_HTTP_PORTS=8080`);
SQL-backed operation requires no writes to the application directory.

`GET /health` remains anonymous liveness/startup health. `GET /health/ready` returns
`200 {"status":"ok"}` when the database is reachable and `503 {"status":"unavailable"}` otherwise.
Neither path uses the SPA fallback.
