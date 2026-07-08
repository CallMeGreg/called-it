namespace CalledIt.Domain.Entities;

/// <summary>A rotating refresh token with reuse detection support.</summary>
public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }

    /// <summary>Hash of the opaque refresh token value.</summary>
    public string TokenHash { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public bool Revoked { get; set; }

    /// <summary>When rotated, points at the token that replaced this one (reuse detection).</summary>
    public Guid? ReplacedById { get; set; }
}
