namespace CalledIt.Application.Common;

/// <summary>Auth/token configuration (bound from configuration / Key Vault).</summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    public string Issuer { get; set; } = "called-it";
    public string Audience { get; set; } = "called-it-clients";

    /// <summary>HS256 signing secret, at least 32 UTF-8 bytes; supplied securely outside Development.</summary>
    public string SigningKey { get; set; } = string.Empty;

    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;
    public int OtpMinutes { get; set; } = 5;
    public int OtpMaxAttempts { get; set; } = 5;

    // --- OTP request throttling (anti SMS-pumping / toll fraud) ---

    /// <summary>Minimum seconds between consecutive OTP sends to the same phone number.</summary>
    public int OtpResendCooldownSeconds { get; set; } = 60;

    /// <summary>Maximum OTP sends to the same phone number within a rolling hour.</summary>
    public int OtpRequestsPerHour { get; set; } = 5;

    /// <summary>Maximum OTP sends to the same phone number within a rolling 24 hours.</summary>
    public int OtpRequestsPerDay { get; set; } = 10;
}
