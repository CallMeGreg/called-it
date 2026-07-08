namespace CalledIt.Application.Abstractions;

public sealed record LeaderboardEntry(string Member, double Score, long Rank);

/// <summary>
/// A ranked leaderboard store backed by Redis Sorted Sets in production (with an in-memory
/// implementation for local/dev). Boards are addressed by a string key such as
/// "streak:sports:global" or "total:friends:{userId}".
/// </summary>
public interface ILeaderboardStore
{
    Task SetScoreAsync(string boardKey, string member, double score, CancellationToken ct = default);

    Task<IReadOnlyList<LeaderboardEntry>> TopAsync(string boardKey, int count, CancellationToken ct = default);

    Task<LeaderboardEntry?> GetAsync(string boardKey, string member, CancellationToken ct = default);

    /// <summary>Return the given members ranked within a board (used for friends/league views).</summary>
    Task<IReadOnlyList<LeaderboardEntry>> SubsetAsync(
        string boardKey, IEnumerable<string> members, CancellationToken ct = default);
}
