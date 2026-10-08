using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;

namespace CalledIt.Infrastructure.Persistence;

/// <summary>
/// Development-only schema creation and seeding. Deployed hosts require a separate migrator
/// and seed lifecycle and only perform read-only prerequisite checks.
/// </summary>
public sealed class DbInitializer
{
    private readonly AppDbContext _db;
    private readonly GameOptions _game;
    private readonly IHostEnvironment _environment;

    public DbInitializer(AppDbContext db, IOptions<GameOptions> game, IHostEnvironment environment)
    {
        _db = db;
        _game = game.Value;
        _environment = environment;
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        if (!_environment.IsDevelopment())
        {
            throw new InvalidOperationException(
                "Runtime migration and seeding are only permitted in Development. Use a separate migrator/bootstrap identity.");
        }

        if (_db.Database.IsSqlite())
        {
            await _db.Database.EnsureCreatedAsync(ct);
        }
        else
        {
            await _db.Database.MigrateAsync(ct);
        }

        await SeedCategoriesAsync(ct);
        await SeedResolutionSourcesAsync(ct);
        await SeedAdminsAsync(ct);
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
            var user = await _db.Users.FirstOrDefaultAsync(u => u.PhoneE164 == phone, ct);
            if (user is not null && !user.IsAdmin)
            {
                user.IsAdmin = true;
            }
        }

        await _db.SaveChangesAsync(ct);
    }
}
