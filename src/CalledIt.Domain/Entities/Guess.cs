namespace CalledIt.Domain.Entities;

/// <summary>
/// A player's response to one question in a daily set: either a binary pick or a skip.
/// Unique per (user, question). Skips preserve a streak; a pick is scored on resolution.
/// </summary>
public class Guess
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }
    public Guid DailySetId { get; set; }
    public Guid QuestionId { get; set; }

    public string CategoryCode { get; set; } = string.Empty;

    /// <summary>The chosen side, or null when <see cref="IsSkip"/> is true.</summary>
    public Side? Pick { get; set; }

    /// <summary>True if the player skipped (protects the streak without growing it).</summary>
    public bool IsSkip { get; set; }

    public DateTimeOffset SubmittedAt { get; set; } = DateTimeOffset.UtcNow;
}
