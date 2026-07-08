namespace CalledIt.Application.Common;

/// <summary>Auth/token configuration (bound from configuration / Key Vault).</summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    public string Issuer { get; set; } = "called-it";
    public string Audience { get; set; } = "called-it-clients";

    /// <summary>Symmetric signing key for dev; production uses a Key Vault-managed key.</summary>
    public string SigningKey { get; set; } = string.Empty;

    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;
    public int OtpMinutes { get; set; } = 5;
    public int OtpMaxAttempts { get; set; } = 5;
}
