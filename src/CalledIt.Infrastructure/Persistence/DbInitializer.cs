using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace CalledIt.Infrastructure.Persistence;

/// <summary>
/// Prepares the database on startup: applies migrations for relational providers that have them
/// (SQL Server), or creates the schema for the SQLite dev/test database, then seeds the fixed
/// categories, a couple of resolution sources, and any bootstrap admin accounts.
/// </summary>
public sealed class DbInitializer
{
    private readonly AppDbContext _db;
    private readonly GameOptions _game;
    private readonly bool _applyMigrations;
    private readonly TestModeOptions _testMode;
    private readonly ITestModeTransaction _testTransaction;

    public DbInitializer(
        AppDbContext db, IOptions<GameOptions> game, IConfiguration configuration,
        IOptions<TestModeOptions> testMode, ITestModeTransaction testTransaction)
    {
        _db = db;
        _game = game.Value;
        _applyMigrations = configuration.GetValue("Database:ApplyMigrationsOnStartup", true);
        _testMode = testMode.Value;
        _testTransaction = testTransaction;
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        if (_applyMigrations && _db.Database.IsSqlite())
        {
            await _db.Database.EnsureCreatedAsync(ct);
        }
        else if (_applyMigrations)
        {
            await _db.Database.MigrateAsync(ct);
        }
        else if (!_db.Database.IsSqlite() && (await _db.Database.GetPendingMigrationsAsync(ct)).Any())
        {
            throw new InvalidOperationException(
                "Database migrations are pending. Apply them before starting the API.");
        }

        if (_testMode.Enabled)
        {
            await _testTransaction.ExecuteAsync(async () =>
            {
                await SeedAsync(ct);
                return true;
            }, ct);
        }
        else
        {
            await SeedAsync(ct);
        }
    }

    private async Task SeedAsync(CancellationToken ct)
    {
        await SeedCategoriesAsync(ct);
        await SeedResolutionSourcesAsync(ct);
        if (!_testMode.Enabled)
        {
            await SeedAdminsAsync(ct);
        }
    }

    private async Task SeedCategoriesAsync(CancellationToken ct)
    {
        foreach (var code in Categories.All)
        {
            if (!await _db.Categories.AnyAsync(c => c.Code == code, ct))
            {
                _db.Categories.Add(new Category { Code = code, DisplayName = Categories.DisplayName(code) });
            }
        }

        await _db.SaveChangesAsync(ct);
    }

    private async Task SeedResolutionSourcesAsync(CancellationToken ct)
    {
        var sources = new (string Key, string Desc)[]
        {
            ("stub", "Deterministic stub resolver for local/dev and demos."),
            ("sports.scores.v1", "Sports scores/results feed."),
            ("finance.marketdata.v1", "Market close / index data feed."),
            ("popculture.editorial.v1", "Editorially-confirmed pop-culture outcomes."),
        };

        foreach (var (key, desc) in sources)
        {
            if (!await _db.ResolutionSources.AnyAsync(s => s.Key == key, ct))
            {
                _db.ResolutionSources.Add(new ResolutionSource { Key = key, Description = desc });
            }
        }

        await _db.SaveChangesAsync(ct);
    }

    private async Task SeedAdminsAsync(CancellationToken ct)
    {
        foreach (var phone in _game.AdminBootstrapPhones)
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.TestInviteId == null && u.PhoneE164 == phone, ct);
            if (user is not null && !user.IsAdmin)
            {
                user.IsAdmin = true;
            }
        }

        await _db.SaveChangesAsync(ct);
    }
}
