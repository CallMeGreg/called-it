namespace CalledIt.Application.Abstractions;

public sealed record PushMessage(string Title, string Body, IReadOnlyDictionary<string, string>? Data = null);

/// <summary>
/// Fans out push notifications to iOS devices via Azure Notification Hubs (APNs).
/// A "tag" targets a set of registrations (per-user, per-league, or "all" for the global drop).
/// </summary>
public interface IPushSender
{
    Task SendToTagAsync(string tag, PushMessage message, CancellationToken ct = default);

    Task BroadcastAsync(PushMessage message, CancellationToken ct = default);
}
