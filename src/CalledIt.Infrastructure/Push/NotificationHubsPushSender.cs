using CalledIt.Application.Abstractions;
using Microsoft.Azure.NotificationHubs;
using Microsoft.Extensions.Options;

namespace CalledIt.Infrastructure.Push;

/// <summary>
/// Fans out notifications through Azure Notification Hubs using template registrations, so a
/// single call reaches iOS devices via APNs. Devices register with a "messageParam"/"title"/"body"
/// template and per-user / "all" tags.
/// </summary>
public sealed class NotificationHubsPushSender : IPushSender
{
    private readonly NotificationHubClient _client;

    public NotificationHubsPushSender(IOptions<NotificationHubsOptions> options)
    {
        var opt = options.Value;
        _client = NotificationHubClient.CreateClientFromConnectionString(opt.ConnectionString, opt.HubName);
    }

    public Task SendToTagAsync(string tag, PushMessage message, CancellationToken ct = default) =>
        _client.SendTemplateNotificationAsync(ToProperties(message), tag);

    public Task BroadcastAsync(PushMessage message, CancellationToken ct = default) =>
        _client.SendTemplateNotificationAsync(ToProperties(message));

    private static IDictionary<string, string> ToProperties(PushMessage message)
    {
        var props = new Dictionary<string, string>
        {
            ["title"] = message.Title,
            ["body"] = message.Body,
        };

        if (message.Data is not null)
        {
            foreach (var (k, v) in message.Data)
            {
                props[$"data_{k}"] = v;
            }
        }

        return props;
    }
}
