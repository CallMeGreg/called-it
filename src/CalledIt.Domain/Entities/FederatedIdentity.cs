namespace CalledIt.Domain.Entities;

/// <summary>A linked federated login (Sign in with Apple / Google) for a user.</summary>
public class FederatedIdentity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }

    public SocialProvider Provider { get; set; }

    /// <summary>The provider's stable subject identifier (the OIDC `sub` claim).</summary>
    public string Subject { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
