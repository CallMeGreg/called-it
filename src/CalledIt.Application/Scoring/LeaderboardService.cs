using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Scoring;

/// <summary>
/// Ranks persisted score/streak projections in the database. Friends boards include accepted
/// friends and the caller; ties have deterministic display order and retain ordinal ranks.
/// </summary>
public sealed class LeaderboardService
{
    private readonly IAppDbContext _db;

    public LeaderboardService(IAppDbContext db) => _db = db;

    public async Task<LeaderboardResult> GetAsync(
        BoardType type,
        BoardScope scope,
        Guid currentUserId,
        string? categoryCode = null,
        int count = 50,
        CancellationToken ct = default)
    {
        if (!Enum.IsDefined(scope))
        {
            throw new ValidationException("Unknown board scope.");
        }
        if (count is < 1 or > 100)
        {
            throw new ValidationException("Leaderboard count must be between 1 and 100.");
        }

        if (type is BoardType.CategoryStreak or BoardType.CategoryBestStreak)
        {
            RequireCategory(categoryCode);
        }
        else if (categoryCode is not null)
        {
            throw new ValidationException("Category must be omitted for an overall or total-score board.");
        }

        IQueryable<BoardValue> values = type switch
        {
            BoardType.CategoryStreak => _db.Streaks.AsNoTracking()
                .Where(s => s.CategoryCode == categoryCode)
                .Select(s => new BoardValue { UserId = s.UserId, Value = s.Current }),
            BoardType.CategoryBestStreak => _db.Streaks.AsNoTracking()
                .Where(s => s.CategoryCode == categoryCode)
                .Select(s => new BoardValue { UserId = s.UserId, Value = s.Best }),
            BoardType.OverallStreak => _db.Streaks.AsNoTracking()
                .GroupBy(s => s.UserId)
                .Select(g => new BoardValue { UserId = g.Key, Value = g.Sum(s => s.Current) }),
            BoardType.TotalScore => _db.Scores.AsNoTracking()
                .GroupBy(s => s.UserId)
                .Select(g => new BoardValue { UserId = g.Key, Value = g.Sum(s => s.TotalCorrect) }),
            _ => throw new ValidationException("Unknown board type."),
        };

        var query = from value in values
                    join user in _db.Users.AsNoTracking() on value.UserId equals user.Id
                    select new { value.UserId, user.DisplayName, value.Value };

        if (scope == BoardScope.Friends)
        {
            query = query.Where(row => row.UserId == currentUserId || _db.Friendships.Any(f =>
                f.Status == FriendshipStatus.Accepted
                && ((f.RequesterId == currentUserId && f.AddresseeId == row.UserId)
                    || (f.AddresseeId == currentUserId && f.RequesterId == row.UserId))));
        }

        var entries = await query.OrderByDescending(row => row.Value)
            .ThenBy(row => row.UserId)
            .Take(count)
            .ToListAsync(ct);
        var rows = entries.Select((row, index) => new LeaderboardRow(
            index + 1, row.UserId, row.DisplayName, row.Value, row.UserId == currentUserId)).ToList();

        return new LeaderboardResult(type, scope, categoryCode, rows);
    }

    private static string RequireCategory(string? categoryCode)
    {
        if (string.IsNullOrWhiteSpace(categoryCode) || !Categories.IsValid(categoryCode))
        {
            throw new ValidationException("A valid category is required for this board.");
        }

        return categoryCode;
    }

    private sealed class BoardValue
    {
        public Guid UserId { get; init; }
        public int Value { get; init; }
    }
}
