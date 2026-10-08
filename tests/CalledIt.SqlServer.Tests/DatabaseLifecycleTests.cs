using System.Text.RegularExpressions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using CalledIt.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit.Abstractions;
using MigrationCommand = CalledIt.Migrator.MigrationCommand;

namespace CalledIt.SqlServer.Tests;

[Collection(SqlServerCollection.Name)]
[Trait("Category", "SqlServer")]
public sealed class DatabaseLifecycleTests(SqlServerFixture server, ITestOutputHelper output)
{
    [Fact]
    public async Task Clean_bootstrap_and_repeated_commands_are_independent_of_runtime_startup()
    {
        output.WriteLine($"SQL Server version: {server.ServerVersion}");
        await using var database = await server.CreateDatabaseAsync();
        Assert.Equal(1, await RunAsync(database, "status"));
        Assert.Equal(2, await RunAsync(database, "seed-categories"));
        Assert.Equal(0, await RunAsync(database, "migrate"));
        Assert.Equal(0, await RunAsync(database, "migrate"));
        await using var db = database.CreateContext();
        Assert.False(db.Database.HasPendingModelChanges());
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await db.Categories.ToListAsync());
        Assert.Equal(1, await RunAsync(database, "status"));

        Assert.Equal(0, await RunAsync(database, "seed-categories"));
        var first = await db.Categories.AsNoTracking().OrderBy(c => c.Code).ToListAsync();
        Assert.Equal(0, await RunAsync(database, "seed-categories"));
        Assert.Equal(first.Select(c => c.Id), await db.Categories.OrderBy(c => c.Code).Select(c => c.Id).ToListAsync());
        Assert.Equal(Categories.All.Order(), first.Select(c => c.Code));
        Assert.Empty(await db.ResolutionSources.ToListAsync());
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Equal(0, await RunAsync(database, "status"));
    }

    [Fact]
    public async Task Upgrade_preserves_existing_rows_and_gives_social_subjects_binary_collation()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.GetService<IMigrator>().MigrateAsync("20260708044525_InitialCreate");
        var user = new User { PhoneE164 = "+15551000001", PhoneHash = "hash", DisplayName = "Existing" };
        var category = new Category { Code = Categories.Sports, DisplayName = "Reviewed name" };
        db.Users.Add(user);
        db.Categories.Add(category);
        db.FederatedIdentities.Add(new FederatedIdentity
        {
            UserId = user.Id, Provider = SocialProvider.Google, Subject = "CaseSensitive",
        });
        await db.SaveChangesAsync();

        Assert.Equal(2, await RunAsync(database, "seed-categories"));
        Assert.Equal(0, await RunAsync(database, "migrate"));
        Assert.Equal(0, await RunAsync(database, "seed-categories"));
        db.ChangeTracker.Clear();
        Assert.Equal("Existing", (await db.Users.SingleAsync()).DisplayName);
        Assert.Equal("Reviewed name", (await db.Categories.SingleAsync(c => c.Id == category.Id)).DisplayName);
        Assert.Equal("CaseSensitive", (await db.FederatedIdentities.SingleAsync()).Subject);
        var collation = await db.Database.SqlQueryRaw<string>("""
            SELECT collation_name AS [Value] FROM sys.columns
            WHERE object_id = OBJECT_ID(N'dbo.FederatedIdentities') AND name = N'Subject'
            """).SingleAsync();
        Assert.Equal("Latin1_General_100_BIN2", collation);
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task Offline_review_script_bootstraps_sql_server_and_can_be_applied_twice()
    {
        await using var database = await server.CreateDatabaseAsync();
        using var script = new StringWriter();
        Assert.Equal(0, await MigrationCommand.RunAsync(["script"], null, script, TextWriter.Null));
        await using var db = database.CreateContext();
        await db.Database.OpenConnectionAsync();
        var batches = Regex.Split(script.ToString(), @"^\s*GO\s*$", RegexOptions.Multiline)
            .Where(batch => !string.IsNullOrWhiteSpace(batch)).ToArray();
        for (var attempt = 0; attempt < 2; attempt++)
        {
            foreach (var batch in batches)
            {
                await db.Database.ExecuteSqlRawAsync(batch);
            }
        }
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
        Assert.Equal(0, await RunAsync(database, "seed-categories"));
        Assert.True(await Readiness(db).IsReadyAsync());
    }

    [Fact]
    public async Task Missing_target_fails_without_creating_a_database()
    {
        var database = await server.CreateDatabaseAsync();
        await database.DisposeAsync();

        Assert.Equal(1, await RunAsync(database, "migrate"));
        var master = new SqlConnectionStringBuilder(database.ConnectionString) { InitialCatalog = "master" };
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(master.ConnectionString).Options);
        Assert.Equal(0, await db.Database.SqlQuery<int>(
            $"SELECT COUNT(*) AS [Value] FROM sys.databases WHERE name = {database.Name}").SingleAsync());
    }

    [Fact]
    public async Task Concurrent_migrators_converge_on_one_complete_migration_history()
    {
        await using var database = await server.CreateDatabaseAsync();
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => RunAsync(database, "migrate")));
        Assert.All(results, result => Assert.Equal(0, result));
        await using var db = database.CreateContext();
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await db.Categories.ToListAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Concurrent_seed_commands_converge_without_duplicates_or_replacing_existing_ids(bool partialSeed)
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.Database.MigrateAsync();
        var existing = new Category { Code = Categories.Finance, DisplayName = "Existing finance" };
        if (partialSeed)
        {
            db.Categories.Add(existing);
            await db.SaveChangesAsync();
        }

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            MigrationCommand.RunAsync(["seed-categories", "--database", database.Name, "--apply"],
                database.ConnectionString, TextWriter.Null, TextWriter.Null)));

        Assert.All(results, result => Assert.Equal(0, result));
        Assert.Equal(3, await db.Categories.CountAsync());
        if (partialSeed)
        {
            Assert.Equal("Existing finance", (await db.Categories.SingleAsync(c => c.Id == existing.Id)).DisplayName);
        }
    }

    [Theory]
    [InlineData("SPORTS")]
    [InlineData("sports ")]
    public async Task Case_insensitive_database_cannot_make_noncanonical_categories_appear_ready(string code)
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.Database.MigrateAsync();
        await FixedCategorySeeder.SeedAsync(db);
        var sports = await db.Categories.SingleAsync(c => c.Code == Categories.Sports);
        sports.Code = code;
        await db.SaveChangesAsync();

        Assert.True(await db.Categories.AnyAsync(c => c.Code == Categories.Sports));
        Assert.False(await Readiness(db).IsReadyAsync());
        Assert.Equal(1, await RunAsync(database, "seed-categories"));
        Assert.Equal(3, await db.Categories.CountAsync());
        Assert.Equal(code, (await db.Categories.AsNoTracking().SingleAsync(c => c.Id == sports.Id)).Code);
    }

    [Theory]
    [InlineData("status")]
    [InlineData("migrate")]
    [InlineData("seed-categories")]
    public async Task Unknown_migration_history_blocks_older_tooling(string command)
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
            VALUES (N'99999999999999_UnknownRelease', N'10.0.9')
            """);
        Assert.Equal(2, await RunAsync(database, command));
        Assert.Empty(await db.Categories.ToListAsync());
    }

    [Fact]
    public async Task Runtime_can_read_and_write_application_data_but_cannot_change_schema_seeds_or_permissions()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using (var owner = database.CreateContext())
        {
            await owner.Database.MigrateAsync();
            await FixedCategorySeeder.SeedAsync(owner);
            var roleScript = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Sql/runtime-role.sql"));
            await owner.Database.ExecuteSqlRawAsync(roleScript);
            await owner.Database.ExecuteSqlRawAsync(roleScript);
            await owner.Database.ExecuteSqlRawAsync("""
                CREATE USER [calledit_runtime_test] WITHOUT LOGIN;
                CREATE USER [calledit_grant_target] WITHOUT LOGIN;
                ALTER ROLE [calledit_runtime] ADD MEMBER [calledit_runtime_test];
                """);
        }

        await using var connection = new SqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options);
        string[] grants =
        [
            "GRANT SELECT ON OBJECT::[dbo].[Users] TO [calledit_grant_target]",
            "GRANT UPDATE ON OBJECT::[dbo].[Categories] TO [calledit_grant_target]",
        ];
        await db.Database.ExecuteSqlRawAsync("EXECUTE AS USER = N'calledit_runtime_test'");
        try
        {
            await Startup(db).PrepareAsync();
            Assert.Empty(db.ChangeTracker.Entries());
            var user = new User { PhoneE164 = "+15551000002", PhoneHash = "hash", DisplayName = "Runtime insert" };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            user.DisplayName = "Runtime update";
            await db.SaveChangesAsync();
            Assert.Equal("Runtime update", (await db.Users.AsNoTracking().SingleAsync()).DisplayName);
            db.Users.Remove(user);
            await db.SaveChangesAsync();
            Assert.Empty(await db.Users.ToListAsync());

            string[] forbidden =
            [
                "CREATE TABLE [dbo].[RuntimeMustNotCreate] ([Id] int NOT NULL)",
                "ALTER TABLE [dbo].[Users] ADD [RuntimeMustNotAlter] int NULL",
                "DROP TABLE [dbo].[Guesses]",
                "CREATE USER [RuntimeMustNotCreateUser] WITHOUT LOGIN",
                "CREATE ROLE [RuntimeMustNotCreateRole]",
                "ALTER ROLE [db_owner] ADD MEMBER [calledit_runtime_test]",
                "DELETE FROM [dbo].[Categories]",
                "DELETE FROM [dbo].[AuditLogs]",
                "DELETE FROM [dbo].[__EFMigrationsHistory]",
            ];
            var denials = new List<(string Sql, int Number)>();
            foreach (var sql in forbidden)
            {
                var failure = await Assert.ThrowsAsync<SqlException>(() => db.Database.ExecuteSqlRawAsync(sql));
                output.WriteLine($"SQL {failure.Number} rejected: {sql}");
                denials.Add((sql, failure.Number));
            }
            Assert.All(denials, denial => Assert.True(
                new[] { 229, 262, 1088, 15151, 15247, 4902, 3701, 2760 }.Contains(denial.Number),
                $"Unexpected SQL error {denial.Number} for: {denial.Sql}"));

            // GRANT can return a warning rather than throwing; verify the effective permissions below.
            foreach (var grant in grants)
            {
                try
                {
                    await db.Database.ExecuteSqlRawAsync(grant);
                    output.WriteLine($"GRANT returned without an exception; checking effective permissions: {grant}");
                }
                catch (SqlException failure)
                {
                    output.WriteLine($"SQL {failure.Number} rejected: {grant}");
                }
            }
        }
        finally
        {
            await db.Database.ExecuteSqlRawAsync("REVERT");
        }
        await AssertGrantPermissionsAsync(db, expected: 0);
        foreach (var grant in grants)
        {
            await db.Database.ExecuteSqlRawAsync(grant);
        }
        await AssertGrantPermissionsAsync(db, expected: 1);
    }

    [Fact]
    public async Task Production_startup_succeeds_for_read_only_user_but_does_not_bootstrap_an_empty_database()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var owner = database.CreateContext();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Startup(owner).PrepareAsync());
        Assert.Equal(0, await owner.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS [Value] FROM sys.tables WHERE is_ms_shipped = 0").SingleAsync());
        await owner.Database.MigrateAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Startup(owner).PrepareAsync());
        Assert.Empty(await owner.Categories.ToListAsync());
        await FixedCategorySeeder.SeedAsync(owner);
        await owner.Database.ExecuteSqlRawAsync("""
            CREATE USER [calledit_readonly_test] WITHOUT LOGIN;
            ALTER ROLE [db_datareader] ADD MEMBER [calledit_readonly_test];
            """);

        await using var connection = new SqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options);
        await db.Database.ExecuteSqlRawAsync("EXECUTE AS USER = N'calledit_readonly_test'");
        try
        {
            await Startup(db).PrepareAsync();
            Assert.Empty(db.ChangeTracker.Entries());
            var failure = await Assert.ThrowsAsync<SqlException>(() =>
                db.Database.ExecuteSqlRawAsync("DELETE FROM [dbo].[Users]"));
            Assert.Equal(229, failure.Number);
        }
        finally
        {
            await db.Database.ExecuteSqlRawAsync("REVERT");
        }
    }

    private async Task<int> RunAsync(SqlTestDatabase database, string command)
    {
        using var messages = new StringWriter();
        using var errors = new StringWriter();
        string[] args = command == "status"
            ? [command, "--database", database.Name]
            : [command, "--database", database.Name, "--apply"];
        var result = await MigrationCommand.RunAsync(args, database.ConnectionString, messages, errors);
        output.WriteLine(messages.ToString());
        output.WriteLine(errors.ToString());
        return result;
    }

    private static DatabaseReadiness Readiness(AppDbContext db) => new(db, NullLogger<DatabaseReadiness>.Instance);

    private static async Task AssertGrantPermissionsAsync(AppDbContext db, int expected)
    {
        await db.Database.ExecuteSqlRawAsync("EXECUTE AS USER = N'calledit_grant_target'");
        try
        {
            Assert.Equal(expected, await db.Database.SqlQueryRaw<int>(
                "SELECT HAS_PERMS_BY_NAME(N'dbo.Users', N'OBJECT', N'SELECT') AS [Value]").SingleAsync());
            Assert.Equal(expected, await db.Database.SqlQueryRaw<int>(
                "SELECT HAS_PERMS_BY_NAME(N'dbo.Categories', N'OBJECT', N'UPDATE') AS [Value]").SingleAsync());
        }
        finally
        {
            await db.Database.ExecuteSqlRawAsync("REVERT");
        }
    }

    private static DatabaseStartup Startup(AppDbContext db)
    {
        var environment = new ProductionEnvironment();
        return new DatabaseStartup(environment, new DbInitializer(db, Options.Create(new GameOptions()), environment), Readiness(db));
    }

    private sealed class ProductionEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "CalledIt.SqlServer.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
