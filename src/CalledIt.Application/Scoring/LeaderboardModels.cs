namespace CalledIt.Application.Scoring;

public enum BoardType
{
    CategoryStreak,
    CategoryBestStreak,
    OverallStreak,
    TotalScore,
}

public enum BoardScope
{
    Global,
    Friends,
}

public sealed record LeaderboardRow(long Rank, Guid UserId, string DisplayName, double Score, bool IsMe);

public sealed record LeaderboardResult(BoardType Type, BoardScope Scope, string? CategoryCode, IReadOnlyList<LeaderboardRow> Rows);
