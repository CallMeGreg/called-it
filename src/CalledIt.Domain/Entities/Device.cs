namespace CalledIt.Domain.Entities;

/// <summary>A registered device that can receive push notifications.</summary>
public class Device
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }

    public DevicePlatform Platform { get; set; }

    /// <summary>APNs / FCM registration token.</summary>
    public string PushToken { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastSeenAt { get; set; } = DateTimeOffset.UtcNow;
}
