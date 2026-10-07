namespace CalledIt.Infrastructure.Messaging;

public enum SmsProvider
{
    Disabled,
    Development,
    Acs,
}

public sealed class SmsOptions
{
    public const string SectionName = "Sms";

    public SmsProvider Provider { get; set; } = SmsProvider.Disabled;
}
