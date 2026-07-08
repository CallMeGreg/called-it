using CalledIt.Application.Abstractions;

namespace CalledIt.Application.Notifications;

/// <summary>
/// Composes the game's push-notification moments on top of <see cref="IPushSender"/>:
/// the synchronized global drop, the "window closing / streak at risk" reminder, results,
/// and social pings.
/// </summary>
public sealed class NotificationService
{
    private readonly IPushSender _push;

    public NotificationService(IPushSender push) => _push = push;

    /// <summary>Fired the instant the daily set drops — the same moment for everyone worldwide.</summary>
    public Task BroadcastDropAsync(Guid dailySetId, CancellationToken ct = default) =>
        _push.BroadcastAsync(new PushMessage(
            "Called It — today's 3 are live 🎯",
            "Sports, Finance, Pop Culture. Lock in your calls before the 6-hour window closes.",
            new Dictionary<string, string> { ["type"] = "drop", ["dailySetId"] = dailySetId.ToString() }), ct);

    /// <summary>Reminder before the hard lock: answer or Skip to protect your streaks.</summary>
    public Task BroadcastWindowClosingAsync(CancellationToken ct = default) =>
        _push.BroadcastAsync(new PushMessage(
            "Window closing ⏳",
            "Your streaks are at risk. Answer or Skip before time runs out — a missed day resets them all.",
            new Dictionary<string, string> { ["type"] = "closing" }), ct);

    public Task NotifyResultsAsync(Guid userId, CancellationToken ct = default) =>
        _push.SendToTagAsync($"user:{userId}", new PushMessage(
            "Results are in 📊",
            "See how your calls landed and how your streaks and score moved.",
            new Dictionary<string, string> { ["type"] = "results" }), ct);

    public Task NotifyFriendJoinedAsync(Guid userId, string friendName, CancellationToken ct = default) =>
        _push.SendToTagAsync($"user:{userId}", new PushMessage(
            "A friend joined Called It 👋",
            $"{friendName} is now on Called It. Add them to compare streaks.",
            new Dictionary<string, string> { ["type"] = "social" }), ct);
}
