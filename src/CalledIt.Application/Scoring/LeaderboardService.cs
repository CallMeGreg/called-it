using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Scoring;

/// <summary>
/// Reads the ranked boards from the leaderboard store and decorates them with display names.
/// Friends boards rank the caller's friends (plus themselves) within the same global board.
/// </summary>
public sealed class LeaderboardService
{
    private readonly IAppDbContext _db;
    private readonly ILeaderboardStore _boards;

    public LeaderboardService(IAppDbContext db, ILeaderboardStore boards)
    {
        _db = db;
        _boards = boards;
    }

    public async Task<LeaderboardResult> GetAsync(
        BoardType type,
        BoardScope scope,
        Guid currentUserId,
        string? categoryCode = null,
        int count = 50,
        CancellationToken ct = default)
    {
        var boardKey = ResolveKey(type, categoryCode);

        IReadOnlyList<LeaderboardEntry> entries;
        if (scope == BoardScope.Global)
        {
            entries = await _boards.TopAsync(boardKey, count, ct);
        }
        else
        {
            var members = await FriendMembersAsync(currentUserId, ct);
            entries = await _boards.SubsetAsync(boardKey, members, ct);
            entries = entries.Take(count).ToList();
        }

        var ids = entries
            .Select(e => Guid.TryParse(e.Member, out var g) ? g : (Guid?)null)
            .Where(g => g is not null)
            .Select(g => g!.Value)
            .ToList();

        var names = await _db.Users
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);

        var rows = new List<LeaderboardRow>();
        foreach (var e in entries)
        {
            if (!Guid.TryParse(e.Member, out var uid))
            {
                continue;
            }

            rows.Add(new LeaderboardRow(
                e.Rank,
                uid,
                names.TryGetValue(uid, out var name) ? name : "Player",
                e.Score,
                uid == currentUserId));
        }

        return new LeaderboardResult(type, scope, categoryCode, rows);
    }

    private static string ResolveKey(BoardType type, string? categoryCode) => type switch
    {
        BoardType.CategoryStreak => LeaderboardKeys.CategoryStreak(RequireCategory(categoryCode)),
        BoardType.CategoryBestStreak => LeaderboardKeys.CategoryBestStreak(RequireCategory(categoryCode)),
        BoardType.OverallStreak => LeaderboardKeys.OverallStreak,
        BoardType.TotalScore => LeaderboardKeys.TotalScore,
        _ => throw new ValidationException("Unknown board type."),
    };

    private static string RequireCategory(string? categoryCode)
    {
        if (string.IsNullOrWhiteSpace(categoryCode) || !Categories.IsValid(categoryCode))
        {
            throw new ValidationException("A valid category is required for this board.");
        }

        return categoryCode;
    }

    private async Task<List<string>> FriendMembersAsync(Guid userId, CancellationToken ct)
    {
        var friendIds = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Accepted && (f.RequesterId == userId || f.AddresseeId == userId))
            .Select(f => f.RequesterId == userId ? f.AddresseeId : f.RequesterId)
            .ToListAsync(ct);

        friendIds.Add(userId);
        return friendIds.Select(id => id.ToString()).Distinct().ToList();
    }
}
