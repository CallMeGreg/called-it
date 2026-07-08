using CalledIt.Application.Abstractions;
using Microsoft.Extensions.Logging;

namespace CalledIt.Infrastructure.Push;

/// <summary>Dev push sender: logs notifications instead of delivering them.</summary>
public sealed class DevPushSender : IPushSender
{
    private readonly ILogger<DevPushSender> _logger;

    public DevPushSender(ILogger<DevPushSender> logger) => _logger = logger;

    public Task SendToTagAsync(string tag, PushMessage message, CancellationToken ct = default)
    {
        _logger.LogInformation("[DEV PUSH → {Tag}] {Title}: {Body}", tag, message.Title, message.Body);
        return Task.CompletedTask;
    }

    public Task BroadcastAsync(PushMessage message, CancellationToken ct = default)
    {
        _logger.LogInformation("[DEV PUSH → all] {Title}: {Body}", message.Title, message.Body);
        return Task.CompletedTask;
    }
}
