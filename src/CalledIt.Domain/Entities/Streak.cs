namespace CalledIt.Domain.Entities;

/// <summary>Persisted per-(user, category) streak snapshot. Rebuildable from history.</summary>
public class Streak
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string CategoryCode { get; set; } = string.Empty;

    public int Current { get; set; }
    public int Best { get; set; }

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
