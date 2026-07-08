namespace CalledIt.Infrastructure.Push;

public sealed class NotificationHubsOptions
{
    public const string SectionName = "NotificationHubs";

    public string ConnectionString { get; set; } = string.Empty;
    public string HubName { get; set; } = string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ConnectionString) && !string.IsNullOrWhiteSpace(HubName);
}
