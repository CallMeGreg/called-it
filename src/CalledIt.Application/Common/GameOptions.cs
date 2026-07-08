namespace CalledIt.Application.Common;

/// <summary>Game-wide configuration for the daily drop.</summary>
public sealed class GameOptions
{
    public const string SectionName = "Game";

    /// <summary>Length of the submission window (drop → lock). Fixed at 6 hours per the spec.</summary>
    public int SubmissionWindowHours { get; set; } = 6;

    /// <summary>Phone numbers (E.164) that are granted the admin role on first sight.</summary>
    public string[] AdminBootstrapPhones { get; set; } = Array.Empty<string>();
}
