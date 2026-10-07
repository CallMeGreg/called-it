namespace CalledIt.Application.Common;

/// <summary>
/// Builds the string keys used to address leaderboards in the store. Global boards use a single
/// key; friends/league boards are computed by ranking a member subset of the corresponding
/// global board, so they share the same underlying key.
/// </summary>
public static class LeaderboardKeys
{
    public const string TestPrefix = "test:";
    public static string InMode(string key, bool isTest) => isTest ? TestPrefix + key : key;

    public static string CategoryStreak(string categoryCode) => $"streak:{categoryCode}";
    public static string CategoryBestStreak(string categoryCode) => $"beststreak:{categoryCode}";
    public const string OverallStreak = "streak:overall";
    public const string TotalScore = "total:score";
}
