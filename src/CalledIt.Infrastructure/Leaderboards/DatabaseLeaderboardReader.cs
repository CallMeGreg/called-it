using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Infrastructure.Leaderboards;

/// <summary>Reads the authoritative score/streak rows; no cache warmup or duplicate persistence.</summary>
public sealed class DatabaseLeaderboardReader(IAppDbContext db) : ILeaderboardReader
{
    public async Task<IReadOnlyList<LeaderboardEntry>> TopAsync(
        string boardKey, int count, CancellationToken ct = default) =>
        Rank(await Ordered(ScoresFor(boardKey)).Take(count).ToListAsync(ct));

    public async Task<LeaderboardEntry?> GetAsync(
        string boardKey, string member, CancellationToken ct = default) =>
        Rank(await Ordered(ScoresFor(boardKey)).ToListAsync(ct)).FirstOrDefault(e => e.Member == member);

    public async Task<IReadOnlyList<LeaderboardEntry>> SubsetAsync(
        string boardKey, IEnumerable<string> members, CancellationToken ct = default)
    {
        var ids = members.Select(Guid.Parse).Distinct().ToArray();
        return Rank(await Ordered(ScoresFor(boardKey).Where(s => ids.Contains(s.UserId))).ToListAsync(ct));
    }

    private IQueryable<BoardScore> ScoresFor(string boardKey)
    {
        var isTest = boardKey.StartsWith(LeaderboardKeys.TestPrefix, StringComparison.Ordinal);
        var key = isTest ? boardKey[LeaderboardKeys.TestPrefix.Length..] : boardKey;
        var users = db.Users.Where(u => (u.TestInviteId != null) == isTest);

        if (key == LeaderboardKeys.TotalScore)
        {
            return users.Select(u => new BoardScore
            {
                UserId = u.Id,
                Score = db.Scores.Where(s => s.UserId == u.Id).Sum(s => (int?)s.TotalCorrect) ?? 0,
            });
        }

        if (key == LeaderboardKeys.OverallStreak)
        {
            return users.Select(u => new BoardScore
            {
                UserId = u.Id,
                Score = db.Streaks.Where(s => s.UserId == u.Id).Sum(s => (int?)s.Current) ?? 0,
            });
        }

        foreach (var category in Categories.All)
        {
            if (key == LeaderboardKeys.CategoryStreak(category))
            {
                return users.Select(u => new BoardScore
                {
                    UserId = u.Id,
                    Score = db.Streaks.Where(s => s.UserId == u.Id && s.CategoryCode == category)
                        .Select(s => (int?)s.Current).FirstOrDefault() ?? 0,
                });
            }

            if (key == LeaderboardKeys.CategoryBestStreak(category))
            {
                return users.Select(u => new BoardScore
                {
                    UserId = u.Id,
                    Score = db.Streaks.Where(s => s.UserId == u.Id && s.CategoryCode == category)
                        .Select(s => (int?)s.Best).FirstOrDefault() ?? 0,
                });
            }
        }

        throw new ValidationException("Unknown leaderboard.");
    }

    private static IOrderedQueryable<BoardScore> Ordered(IQueryable<BoardScore> scores) =>
        scores.OrderByDescending(s => s.Score).ThenBy(s => s.UserId);

    private static IReadOnlyList<LeaderboardEntry> Rank(IReadOnlyList<BoardScore> scores) =>
        scores.Select((s, i) => new LeaderboardEntry(s.UserId.ToString(), s.Score, i + 1)).ToArray();

    private sealed class BoardScore
    {
        public Guid UserId { get; init; }
        public int Score { get; init; }
    }
}
