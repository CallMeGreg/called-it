using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
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
        if (!Enum.IsDefined(provider) || string.IsNullOrWhiteSpace(idToken))
        {
            throw new ValidationException("A valid social provider and id_token are required.");
        }

        var parts = idToken.Split('|', 2);
        var subject = parts[0].Trim();
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 256)
        {
            throw new ValidationException("A valid social subject is required.");
        }
        var email = parts.Length > 1 ? parts[1].Trim() : null;

        return Task.FromResult(new SocialIdentity(provider, subject, email));
    }
}
