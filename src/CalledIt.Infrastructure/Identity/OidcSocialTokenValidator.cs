using System.IdentityModel.Tokens.Jwt;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace CalledIt.Infrastructure.Identity;

/// <summary>
/// Validates Apple/Google OIDC id_tokens against each provider's published JWKS (signature,
/// issuer, audience, expiry) and returns the stable subject.
/// </summary>
/// <remarks>Challenge/nonce binding is still a separate, unimplemented release gate.</remarks>
public sealed class OidcSocialTokenValidator : ISocialTokenValidator
{
    private const string GoogleIssuer = "https://accounts.google.com";
    private const string AppleIssuer = "https://appleid.apple.com";

    private readonly SocialAuthOptions _options;
    private readonly IConfigurationManager<OpenIdConnectConfiguration> _google;
    private readonly IConfigurationManager<OpenIdConnectConfiguration> _apple;

    public OidcSocialTokenValidator(IOptions<SocialAuthOptions> options)
        : this(options, Create($"{GoogleIssuer}/.well-known/openid-configuration"),
            Create($"{AppleIssuer}/.well-known/openid-configuration"))
    {
    }

    public OidcSocialTokenValidator(
        IOptions<SocialAuthOptions> options,
        IConfigurationManager<OpenIdConnectConfiguration> google,
        IConfigurationManager<OpenIdConnectConfiguration> apple)
    {
        _options = options.Value;
        if (string.IsNullOrWhiteSpace(_options.GoogleAudience) || string.IsNullOrWhiteSpace(_options.AppleAudience))
        {
            throw new InvalidOperationException("SocialAuth:GoogleAudience and SocialAuth:AppleAudience are required.");
        }

        _google = google;
        _apple = apple;
    }

    public async Task<SocialIdentity> ValidateAsync(SocialProvider provider, string idToken, CancellationToken ct = default)
    {
        var (issuer, audience, manager) = provider switch
        {
            SocialProvider.Google => (GoogleIssuer, _options.GoogleAudience, _google),
            SocialProvider.Apple => (AppleIssuer, _options.AppleAudience, _apple),
            _ => throw new ValidationException("Unknown social provider."),
        };

        if (string.IsNullOrWhiteSpace(idToken))
        {
            throw new ForbiddenException("Invalid social identity token.");
        }

        var config = await manager.GetConfigurationAsync(ct);

        var parameters = new TokenValidationParameters
        {
            ValidIssuer = issuer,
            ValidateIssuer = true,
            ValidAudience = audience,
            ValidateAudience = true,
            IgnoreTrailingSlashWhenValidatingAudience = false,
            IssuerSigningKeys = config.SigningKeys,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            ClockSkew = TimeSpan.FromSeconds(30),
        };

        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        try
        {
            var principal = handler.ValidateToken(idToken, parameters, out _);

            var subject = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
            if (string.IsNullOrWhiteSpace(subject) || subject.Length > 256)
            {
                throw new ForbiddenException("Invalid social identity token.");
            }
            var email = principal.FindFirst(JwtRegisteredClaimNames.Email)?.Value;

            return new SocialIdentity(provider, subject, email);
        }
        catch (SecurityTokenSignatureKeyNotFoundException)
        {
            manager.RequestRefresh();
            throw new ForbiddenException("Invalid social identity token.");
        }
        catch (Exception ex) when (ex is SecurityTokenException or ArgumentException)
        {
            throw new ForbiddenException("Invalid social identity token.");
        }
    }

    private static ConfigurationManager<OpenIdConnectConfiguration> Create(string metadataAddress) =>
        new(metadataAddress, new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever());
}
