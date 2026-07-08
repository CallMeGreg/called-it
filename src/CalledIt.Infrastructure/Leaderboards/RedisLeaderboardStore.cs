using CalledIt.Application.Abstractions;
using StackExchange.Redis;

namespace CalledIt.Infrastructure.Leaderboards;

/// <summary>Leaderboard backed by Redis Sorted Sets (score = streak length or total).</summary>
public sealed class RedisLeaderboardStore : ILeaderboardStore
{
    private readonly IConnectionMultiplexer _redis;

    public RedisLeaderboardStore(IConnectionMultiplexer redis) => _redis = redis;

    private IDatabase Db => _redis.GetDatabase();

    public Task SetScoreAsync(string boardKey, string member, double score, CancellationToken ct = default) =>
        Db.SortedSetAddAsync(boardKey, member, score);

    public async Task<IReadOnlyList<LeaderboardEntry>> TopAsync(string boardKey, int count, CancellationToken ct = default)
    {
        var values = await Db.SortedSetRangeByRankWithScoresAsync(boardKey, 0, count - 1, Order.Descending);
        var result = new List<LeaderboardEntry>(values.Length);
        for (var i = 0; i < values.Length; i++)
        {
            result.Add(new LeaderboardEntry(values[i].Element!, values[i].Score, i + 1));
        }

        return result;
    }

    public async Task<LeaderboardEntry?> GetAsync(string boardKey, string member, CancellationToken ct = default)
    {
        var score = await Db.SortedSetScoreAsync(boardKey, member);
        if (score is null)
        {
            return null;
        }

        var rank = await Db.SortedSetRankAsync(boardKey, member, Order.Descending);
        return new LeaderboardEntry(member, score.Value, (rank ?? 0) + 1);
    }

    public async Task<IReadOnlyList<LeaderboardEntry>> SubsetAsync(
        string boardKey, IEnumerable<string> members, CancellationToken ct = default)
    {
        var list = members.Distinct().ToList();
        var scored = new List<(string Member, double Score)>();

        foreach (var m in list)
        {
            var score = await Db.SortedSetScoreAsync(boardKey, m);
            if (score is not null)
            {
                scored.Add((m, score.Value));
            }
        }

        return scored
            .OrderByDescending(s => s.Score)
            .Select((s, i) => new LeaderboardEntry(s.Member, s.Score, i + 1))
            .ToList();
    }
}
