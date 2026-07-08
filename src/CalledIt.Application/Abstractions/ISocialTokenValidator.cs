using CalledIt.Domain;

namespace CalledIt.Application.Abstractions;

/// <summary>The verified identity extracted from a validated Apple/Google id_token.</summary>
public sealed record SocialIdentity(SocialProvider Provider, string Subject, string? Email);

/// <summary>
/// Validates an OIDC id_token from Apple or Google (signature, issuer, audience, expiry)
/// and returns the stable subject. Implemented against provider JWKS in Infrastructure.
/// </summary>
public interface ISocialTokenValidator
{
    Task<SocialIdentity> ValidateAsync(SocialProvider provider, string idToken, CancellationToken ct = default);
}
