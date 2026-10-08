using CalledIt.Application.Common;
using CalledIt.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CalledIt.Application.Tests;

public sealed class DatabaseStartupTests
{
    [Fact]
    public async Task Non_development_startup_succeeds_with_read_only_access_to_existing_schema()
    {
        using var app = new TestApp();
        var connectionString = await app.ScopedAsync(services => Task.FromResult(
            services.GetRequiredService<AppDbContext>().Database.GetConnectionString()));
        var readOnly = new SqliteConnectionStringBuilder(connectionString) { Mode = SqliteOpenMode.ReadOnly };
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(readOnly.ToString()).Options);
        var environment = new TestHostEnvironment(Environments.Production);
        var startup = Startup(db, environment);

        await startup.PrepareAsync();

        Assert.Empty(db.ChangeTracker.Entries());
        await Assert.ThrowsAsync<SqliteException>(() => db.Database.ExecuteSqlRawAsync("DELETE FROM Categories"));
    }

    [Fact]
    public async Task Missing_schema_fails_actionably_without_creating_any_tables()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection).Options);
        var environment = new TestHostEnvironment(Environments.Production);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Startup(db, environment).PrepareAsync());
        Assert.Contains("separate migrator/bootstrap identity", error.Message);
        Assert.DoesNotContain("Data Source", error.Message);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new DbInitializer(db, Options.Create(new GameOptions()), environment).InitializeAsync());
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'";
        Assert.Equal(0L, await command.ExecuteScalarAsync());
    }

    [Fact]
    public async Task Existing_but_unseeded_schema_is_not_ready_and_is_not_seeded_by_production_startup()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Startup(db, new TestHostEnvironment(Environments.Production)).PrepareAsync());
        Assert.Empty(await db.Categories.ToListAsync());
        Assert.Empty(await db.ResolutionSources.ToListAsync());
    }

    [Fact]
    public async Task Missing_guesses_schema_blocks_production_startup_until_restored()
    {
        using var app = new TestApp();
        await app.ScopedAsync(async services =>
        {
            var db = services.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Guesses RENAME TO Guesses_unavailable");
            Assert.True(await db.Database.CanConnectAsync());

            var startup = Startup(db, new TestHostEnvironment(Environments.Production));
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => startup.PrepareAsync());
            Assert.Contains("separate migrator/bootstrap identity", error.Message);
            Assert.Empty(db.ChangeTracker.Entries());

            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Guesses_unavailable RENAME TO Guesses");
            await startup.PrepareAsync();
        });
    }

    private static DatabaseStartup Startup(AppDbContext db, TestHostEnvironment environment) =>
        new(environment, new DbInitializer(db, Options.Create(new GameOptions()), environment),
            new DatabaseReadiness(db, NullLogger<DatabaseReadiness>.Instance));
}
