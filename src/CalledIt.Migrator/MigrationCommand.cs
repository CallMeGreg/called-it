using CalledIt.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;

namespace CalledIt.Migrator;

public static class MigrationCommand
{
    public const string ConnectionVariable = "CALLEDIT_MIGRATOR_CONNECTION_STRING";
    private const string Usage = """
        Usage:
          calledit-migrator script
          calledit-migrator status --database <existing-database>
          calledit-migrator migrate --database <existing-database> --apply
          calledit-migrator seed-categories --database <existing-database> --apply
        script is offline, forward-only, idempotent SQL for review. Other commands require
        CALLEDIT_MIGRATOR_CONNECTION_STRING, supplied privately for a separately authorized
        principal. No runtime connection fallback, database/user creation or permission grants.
        """;

    public static async Task<int> RunAsync(
        string[] args, string? connectionString, TextWriter output, TextWriter error,
        CancellationToken ct = default)
    {
        try
        {
            if (args is ["--help"] or ["help"])
            {
                await output.WriteLineAsync(Usage);
                return 0;
            }

            if (args is ["script"])
            {
                await using var offline = new AppDbContextFactory().CreateDbContext([]);
                await output.WriteLineAsync(offline.GetService<IMigrator>()
                    .GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent));
                return 0;
            }

            if (args.Length < 3 || args[1] != "--database"
                || args[0] is not ("status" or "migrate" or "seed-categories")
                || (args[0] == "status" ? args.Length != 3 : args.Length != 4 || args[3] != "--apply"))
            {
                throw new CommandException(Usage);
            }

            var connection = ValidateConnection(connectionString, args[2]);
            await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlServer(connection.ConnectionString).Options);

            // Opening the explicitly named database first prevents EF from creating a missing database.
            await db.Database.OpenConnectionAsync(ct);
            var known = db.Database.GetMigrations().ToHashSet(StringComparer.Ordinal);
            var applied = (await db.Database.GetAppliedMigrationsAsync(ct)).ToArray();
            if (applied.Any(migration => !known.Contains(migration)))
            {
                throw new CommandException(
                    "Unrecognized migration history. Use the matching reviewed release; automatic downgrade is not supported.");
            }
            var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToArray();

            switch (args[0])
            {
                case "migrate":
                    await db.Database.MigrateAsync(ct);
                    await output.WriteLineAsync("Forward migrations applied. Run seed-categories separately.");
                    return 0;
                case "seed-categories":
                    if (pending.Length != 0)
                    {
                        throw new CommandException("Pending migrations exist. Review and apply them before seeding.");
                    }
                    await FixedCategorySeeder.SeedAsync(db, ct);
                    await output.WriteLineAsync("Fixed categories seeded; existing IDs and display names preserved.");
                    return 0;
                default:
                    var ready = await new DatabaseReadiness(db, NullLogger<DatabaseReadiness>.Instance).IsReadyAsync(ct);
                    await output.WriteLineAsync($"Pending migrations: {pending.Length}.");
                    foreach (var migration in pending)
                    {
                        await output.WriteLineAsync(migration);
                    }
                    await output.WriteLineAsync($"Critical schema and fixed categories ready: {(ready ? "yes" : "no")}.");
                    return pending.Length == 0 && ready ? 0 : 1;
            }
        }
        catch (CommandException ex)
        {
            await error.WriteLineAsync(ex.Message);
            return 2;
        }
        catch (SqlException ex)
        {
            await error.WriteLineAsync($"SQL operation failed (error {ex.Number}). Check the approved database, network and principal permissions.");
            return 1;
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException sql)
        {
            await error.WriteLineAsync($"Database write failed (SQL error {sql.Number}). Review constraints and seed data before retrying.");
            return 1;
        }
        catch (InvalidOperationException)
        {
            await error.WriteLineAsync("Database operation failed. Review model/migration compatibility and canonical category codes; no automatic repair was attempted.");
            return 1;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await error.WriteLineAsync("Database operation cancelled. Check status before retrying.");
            return 130;
        }
    }

    private static SqlConnectionStringBuilder ValidateConnection(string? value, string database)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new CommandException($"Set {ConnectionVariable} privately; runtime credentials are never used as a fallback.");
        }
        SqlConnectionStringBuilder connection;
        try
        {
            connection = new SqlConnectionStringBuilder(value);
        }
        catch (ArgumentException)
        {
            throw new CommandException("Invalid migrator connection string. Do not pass credentials on the command line.");
        }
        if (string.IsNullOrWhiteSpace(connection.DataSource) || string.IsNullOrWhiteSpace(database)
            || !string.Equals(connection.InitialCatalog, database, StringComparison.Ordinal)
            || new[] { "master", "model", "msdb", "tempdb" }.Contains(database.Trim(), StringComparer.OrdinalIgnoreCase)
            || !string.IsNullOrEmpty(connection.AttachDBFilename))
        {
            throw new CommandException("Specify an existing non-system database matching --database exactly; attached files are not supported.");
        }
        return connection;
    }

    private sealed class CommandException(string message) : Exception(message);
}
