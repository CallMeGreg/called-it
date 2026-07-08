namespace CalledIt.Domain.Entities;

/// <summary>A short-lived phone OTP challenge issued during registration/login.</summary>
public class OtpChallenge
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string PhoneE164 { get; set; } = string.Empty;

    /// <summary>Hash of the one-time code (never store the raw code).</summary>
    public string CodeHash { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }
    public int Attempts { get; set; }
    public bool Consumed { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
