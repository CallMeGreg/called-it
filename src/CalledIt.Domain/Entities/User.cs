namespace CalledIt.Domain.Entities;

/// <summary>A player anchored by a verified phone, or an isolated TEST invite.</summary>
public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Verified phone number in E.164 form. Primary human identity.</summary>
    public string? PhoneE164 { get; set; }

    /// <summary>HMAC hash of the phone number, used for privacy-preserving contact matching.</summary>
    public string? PhoneHash { get; set; }

    /// <summary>Non-secret, stable TEST identity. Never linked to a phone or social account.</summary>
    public string? TestInviteId { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Whether this account holds the privileged admin role.</summary>
    public bool IsAdmin { get; set; }

    /// <summary>Whether other users may discover this account by matching their contacts.</summary>
    public bool DiscoverableByPhone { get; set; } = true;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public ICollection<FederatedIdentity> Identities { get; set; } = new List<FederatedIdentity>();
    public ICollection<Device> Devices { get; set; } = new List<Device>();
}
