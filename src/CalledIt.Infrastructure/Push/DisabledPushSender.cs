using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;

namespace CalledIt.Infrastructure.Push;

public sealed class DisabledPushSender : IPushSender
{
    public Task SendToTagAsync(string tag, PushMessage message, CancellationToken ct = default) =>
        throw new FeatureUnavailableException("Push notifications are currently unavailable.");

    public Task BroadcastAsync(PushMessage message, CancellationToken ct = default) =>
        throw new FeatureUnavailableException("Push notifications are currently unavailable.");
}
