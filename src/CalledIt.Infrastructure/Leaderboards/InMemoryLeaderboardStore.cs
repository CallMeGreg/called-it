using System.Collections.Concurrent;
using CalledIt.Application.Abstractions;

namespace CalledIt.Infrastructure.Leaderboards;

/// <summary>
/// In-memory leaderboard for local/dev/tests. Mirrors the semantics of the Redis Sorted Set
/// implementation (higher score = better rank). Not for multi-instance production use.
/// </summary>
public sealed class InMemoryLeaderboardStore : ILeaderboardStore
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, double>> _boards = new();

    public Task SetScoreAsync(string boardKey, string member, double score, CancellationToken ct = default)
    {
        var board = _boards.GetOrAdd(boardKey, _ => new ConcurrentDictionary<string, double>());
        board[member] = score;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<LeaderboardEntry>> TopAsync(string boardKey, int count, CancellationToken ct = default)
    {
        var ranked = Ranked(boardKey).Take(count).ToList();
        return Task.FromResult<IReadOnlyList<LeaderboardEntry>>(ranked);
    }

    public Task<LeaderboardEntry?> GetAsync(string boardKey, string member, CancellationToken ct = default)
    {
        var entry = Ranked(boardKey).FirstOrDefault(e => e.Member == member);
        return Task.FromResult(entry);
    }

    public Task<IReadOnlyList<LeaderboardEntry>> SubsetAsync(
        string boardKey, IEnumerable<string> members, CancellationToken ct = default)
    {
        var set = members.ToHashSet();
        if (!_boards.TryGetValue(boardKey, out var board))
        {
            return Task.FromResult<IReadOnlyList<LeaderboardEntry>>(Array.Empty<LeaderboardEntry>());
        }

        var ranked = board
            .Where(kv => set.Contains(kv.Key))
            .OrderByDescending(kv => kv.Value)
            .Select((kv, i) => new LeaderboardEntry(kv.Key, kv.Value, i + 1))
            .ToList();

        return Task.FromResult<IReadOnlyList<LeaderboardEntry>>(ranked);
    }

    private IEnumerable<LeaderboardEntry> Ranked(string boardKey)
    {
        if (!_boards.TryGetValue(boardKey, out var board))
        {
            yield break;
        }

        var ordered = board.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key);
        long rank = 1;
        foreach (var kv in ordered)
        {
            yield return new LeaderboardEntry(kv.Key, kv.Value, rank++);
        }
    }
}
