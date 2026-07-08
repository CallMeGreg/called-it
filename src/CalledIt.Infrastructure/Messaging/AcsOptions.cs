namespace CalledIt.Infrastructure.Messaging;

public sealed class AcsOptions
{
    public const string SectionName = "Acs";

    public string ConnectionString { get; set; } = string.Empty;

    /// <summary>The provisioned ACS phone number to send from, in E.164.</summary>
    public string FromNumber { get; set; } = string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ConnectionString) && !string.IsNullOrWhiteSpace(FromNumber);
}
