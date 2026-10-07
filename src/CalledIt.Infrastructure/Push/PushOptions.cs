namespace CalledIt.Infrastructure.Push;

public enum PushProvider
{
    Disabled,
    Development,
    NotificationHubs,
}

public sealed class PushOptions
{
    public const string SectionName = "Push";

    public PushProvider Provider { get; set; } = PushProvider.Disabled;
}
