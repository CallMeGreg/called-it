using System.Data.Common;
using CalledIt.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CalledIt.Infrastructure.Persistence;

public sealed class DatabaseReadiness
{
    private readonly AppDbContext _db;
    private readonly ILogger<DatabaseReadiness> _logger;

    public DatabaseReadiness(AppDbContext db, ILogger<DatabaseReadiness> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<bool> IsReadyAsync(CancellationToken ct = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            var categories = await _db.Categories.AsNoTracking()
                .Where(c => Categories.All.Contains(c.Code)).ToListAsync(timeout.Token);
            if (categories.Count != Categories.All.Count)
            {
                _logger.LogWarning("Database readiness failed: fixed categories have not been seeded.");
                return false;
            }

            // Read mapped columns, not just SELECT 1 / connectivity: an empty or stale schema
            // must not appear ready for identity, the daily set, or persisted standings.
            await _db.Users.AsNoTracking().OrderBy(u => u.Id).Take(1).ToListAsync(timeout.Token);
            await _db.FederatedIdentities.AsNoTracking().OrderBy(i => i.Id).Take(1).ToListAsync(timeout.Token);
            await _db.OtpChallenges.AsNoTracking().OrderBy(c => c.Id).Take(1).ToListAsync(timeout.Token);
            await _db.RefreshTokens.AsNoTracking().OrderBy(t => t.Id).Take(1).ToListAsync(timeout.Token);
            await _db.Questions.AsNoTracking().OrderBy(q => q.Id).Take(1).ToListAsync(timeout.Token);
            await _db.DailySets.AsNoTracking().OrderBy(s => s.Id).Take(1).ToListAsync(timeout.Token);
            await _db.DailySetItems.AsNoTracking().OrderBy(i => i.Id).Take(1).ToListAsync(timeout.Token);
            await _db.Guesses.AsNoTracking().OrderBy(g => g.Id).Take(1).ToListAsync(timeout.Token);
            await _db.Scores.AsNoTracking().OrderBy(s => s.Id).Take(1).ToListAsync(timeout.Token);
            await _db.Streaks.AsNoTracking().OrderBy(s => s.Id).Take(1).ToListAsync(timeout.Token);
            await _db.Friendships.AsNoTracking().OrderBy(f => f.Id).Take(1).ToListAsync(timeout.Token);
            return true;
        }
        catch (Exception ex) when (ex is DbException or TimeoutException
                                   || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            _logger.LogWarning("Database readiness failed ({FailureType}).", ex.GetType().Name);
            return false;
        }
    }
}
