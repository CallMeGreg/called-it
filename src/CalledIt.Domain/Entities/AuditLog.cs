namespace CalledIt.Domain.Entities;

/// <summary>An append-only audit record for sensitive actions (esp. outcome sets and amendments).</summary>
public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The user id that performed the action (an admin for overrides), if any.</summary>
    public Guid? ActorId { get; set; }

    public string Action { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;

    /// <summary>Free-form JSON detail (before/after values, reason, source).</summary>
    public string Detail { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
