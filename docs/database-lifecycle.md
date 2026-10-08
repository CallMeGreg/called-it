# SQL Server lifecycle and provider evidence

This is a prerequisite slice for [#7](https://github.com/CallMeGreg/called-it/issues/7),
not approval to deploy or enable gameplay. Production API and worker startup
remain read-only. SQLite development still initializes locally; it is not the
production-provider test lane.

## Separate, explicit migration and seed commands

`src/CalledIt.Migrator` is a separate executable, not an API endpoint, hosted
service, or component of either runtime image. It uses only
`CALLEDIT_MIGRATOR_CONNECTION_STRING`, never the runtime connection configuration.
An authorized database owner must supply a separate principal and an existing,
explicitly named application database. The tool does not create databases,
users, logins, roles, permissions, cloud resources, or secrets.

Review the forward-only idempotent SQL from the exact proposed release first:

```bash
dotnet run --project src/CalledIt.Migrator -c Release -- script
```

This command is offline and needs no credentials. It includes the original
schema and the `CaseSensitiveSocialSubjects` upgrade. That upgrade preserves
stored values and changes the indexed OIDC subject column to
`Latin1_General_100_BIN2`, so case/accent-distinct provider identifiers are not
conflated by the database's default case-insensitive collation. SQL still pads
trailing spaces during comparisons; the existing ordinal application ownership
check remains necessary and is covered by the SQL lane. This is not a new
identity-provider policy or a completion of the identity lifecycle.

After review/authorization, privately inject the migrator connection variable
through the approved operator credential mechanism. Do not put credentials in
arguments, source, shell history, CI parameters, or ordinary logs. For Azure use
the separately authorized Entra migrator, encrypted connections with certificate
verification, and the approved restricted/private network. No SQL-auth fallback
or permission elevation is supplied by this tool.

```bash
dotnet run --project src/CalledIt.Migrator -c Release -- status --database calledit
dotnet run --project src/CalledIt.Migrator -c Release -- migrate --database calledit --apply
dotnet run --project src/CalledIt.Migrator -c Release -- seed-categories --database calledit --apply
dotnet run --project src/CalledIt.Migrator -c Release -- status --database calledit
```

Replace `calledit` with the exact existing database name. It must match the
connection's explicit catalog. System databases, attached files, ambiguous
targets, missing credentials, unrecognized migration history and writes without
`--apply` fail. Opening the target database before invoking EF prevents accidental
database creation. There is no downgrade or automatic repair command.

`migrate` applies only forward schema changes. `seed-categories` requires a
current schema and writes only the three existing fixed category codes. It
preserves existing IDs/display names, fills a partial seed, and serializes SQL
seed attempts with a bounded transaction-owned application lock. A failed
transaction leaves no partial seed. Noncanonical case/whitespace variants fail
for operator review rather than being renamed or merged silently. No users,
admin phones, sample questions, stub resolvers or real feed claims are seeded.

Exit codes: `0` success/current-and-ready status; `1` database failure or
not-ready status; `2` invalid invocation/preconditions; `130` cancellation.
Errors report an actionable class/SQL error number, not connection strings or
raw provider exception contents. After interruption, check history/status and
retry the same reviewed release. Migration and category seeding are separate
recoverable steps, not one cross-step transaction.

Do not automatically run EF `Down` migrations. Once case-distinct subjects
exist, returning to a case-insensitive unique index can fail. Application
rollback must use a schema-compatible version; data recovery and an actual
backup/restore drill remain owner gates.

## Runtime grants are separate from migration authority

After migrations, a database owner can review and apply
[`infra/sql/runtime-role.sql`](../infra/sql/runtime-role.sql). This idempotent
script defines a role with named-object permissions: read-only categories and
resolution-source metadata, append/read-only audit logs, and DML for the other
existing application tables. It
grants no schema/permission management or migration-history writes. New tables
require an explicit reviewed grant change; this is not blanket schema access.

The owner must separately create the contained runtime user for the exact
managed identity, with `dbo` as its default schema, and grant membership only in
`calledit_runtime`. The migrator also uses the `dbo` application schema but
must not share runtime credentials. Verify the runtime has no other inherited
privileges, schema ownership, `db_owner`, `db_ddladmin`, or administrative
membership. The role script cannot revoke pre-existing excessive access or
establish Entra directory lookup/network permissions.

The provider tests impersonate a contained SQL user to exercise these effective
database permissions. They demonstrate runtime CRUD, read-only production
startup, and rejection of table creation/alteration/deletion, seed/history
writes and user/role/grant management. They do **not** authenticate an Azure
managed identity or prove an Azure network path.

## Real SQL Server lane

CI runs `tests/CalledIt.SqlServer.Tests` against a digest-pinned official SQL
Server 2022 Developer container on an x64 Linux runner. Credentials are randomly
generated per job and masked. The port is bound to loopback, each test receives
an internally named `calledit_test_<guid>` database with case-insensitive default
collation and read-committed snapshot enabled, and databases/container are
removed after use. No Azure connection, paid SQL resource or deployment gate
is involved.

The lane covers:

- Clean bootstrap, twice-applied offline SQL, refusal to create a missing database,
  the populated initial-schema upgrade, repeat migration/seed, four concurrent
  migrators, unknown history, and eight concurrent seed commands against both
  empty and partial seeds, plus noncanonical-seed rejection.
- SQL-translated bounded standings/friends filtering and native `datetimeoffset`
  ordering with a frozen clock, without resolving outcomes during open choices.
- Case/accent-sensitive subjects, SQL trailing-space ownership rejection, actual
  foreign-key/length/unique constraints and conflicting concurrent phone inserts.
- Runtime DML versus denied DDL/permission changes and startup under a read-only
  database user, including missing schema and missing seed failures.

Without the connection variable, this project **fails explicitly**; it never
silently skips tests or substitutes SQLite. Fast local/default CI tests exclude
the provider trait:

```bash
dotnet test CalledIt.sln -c Release --filter "Category!=SqlServer"
```

To run the provider lane yourself, use an existing disposable local SQL Server
with a principal allowed to create/drop test databases and impersonate test
users. Set `CALLEDIT_SQLSERVER_TEST_CONNECTION_STRING` privately to that loopback
server with no catalog (or `master`), then run:

```bash
dotnet test tests/CalledIt.SqlServer.Tests -c Release
```

The fixture accepts only `localhost`/`127.0.0.1` and generates database names
internally; it will not target a supplied application catalog. The CI container
uses a self-signed local certificate and an ephemeral SQL login. That exception
is for local tests only, not the Azure Entra-only design. SQL Server's supported
Linux container platform is x64; an ARM Mac without a supported SQL host must
use the Linux CI lane, not an SQLite or retired Azure SQL Edge substitute.

This lane does not prove deadline-safe receipts, publication uniqueness,
enrollment, outbox crash recovery, scoring replay, drop/lock load, native flows,
Azure grants/network/cost, or backup recovery. Those remain on #7. Owner review
of the schema, dedicated migrator identity, reachable database, grant script and
operational recovery procedure is still required before `SQL_BOOTSTRAP_APPROVED`
can be enabled.
