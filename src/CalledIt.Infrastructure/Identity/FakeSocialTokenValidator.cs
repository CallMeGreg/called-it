using CalledIt.Application.Abstractions;
using CalledIt.Domain;

namespace CalledIt.Infrastructure.Identity;

/// <summary>
/// Non-cryptographic validator for local/dev/tests. Accepts an id_token shaped as
/// "subject" or "subject|email" and echoes it back as a verified identity.
/// NEVER enable this in production.
/// </summary>
public sealed class FakeSocialTokenValidator : ISocialTokenValidator
{
    public Task<SocialIdentity> ValidateAsync(SocialProvider provider, string idToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(idToken))
        {
            throw new ArgumentException("id_token is required.", nameof(idToken));
        }

        var parts = idToken.Split('|', 2);
        var subject = parts[0].Trim();
        var email = parts.Length > 1 ? parts[1].Trim() : null;

        return Task.FromResult(new SocialIdentity(provider, subject, email));
    }
}
