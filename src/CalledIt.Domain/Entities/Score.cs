namespace CalledIt.Domain.Entities;

/// <summary>
/// Persisted per-(user, category) lifetime score. <see cref="TotalCorrect"/> is cumulative and
/// never resets — not even when a missed day wipes the player's streaks.
/// </summary>
public class Score
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string CategoryCode { get; set; } = string.Empty;

    public int TotalCorrect { get; set; }

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
