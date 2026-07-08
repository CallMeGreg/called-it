using System.IdentityModel.Tokens.Jwt;
using CalledIt.Application.Abstractions;
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
public sealed class OidcSocialTokenValidator : ISocialTokenValidator
{
    private const string GoogleIssuer = "https://accounts.google.com";
    private const string AppleIssuer = "https://appleid.apple.com";

    private readonly SocialAuthOptions _options;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> _google;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> _apple;

    public OidcSocialTokenValidator(IOptions<SocialAuthOptions> options)
    {
        _options = options.Value;
        _google = Create($"{GoogleIssuer}/.well-known/openid-configuration");
        _apple = Create($"{AppleIssuer}/.well-known/openid-configuration");
    }

    public async Task<SocialIdentity> ValidateAsync(SocialProvider provider, string idToken, CancellationToken ct = default)
    {
        var (issuer, audience, manager) = provider switch
        {
            SocialProvider.Google => (GoogleIssuer, _options.GoogleAudience, _google),
            SocialProvider.Apple => (AppleIssuer, _options.AppleAudience, _apple),
            _ => throw new ArgumentOutOfRangeException(nameof(provider)),
        };

        var config = await manager.GetConfigurationAsync(ct);

        var parameters = new TokenValidationParameters
        {
            ValidIssuer = issuer,
            ValidateIssuer = true,
            ValidAudience = audience,
            ValidateAudience = !string.IsNullOrWhiteSpace(audience),
            IssuerSigningKeys = config.SigningKeys,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
        };

        var handler = new JwtSecurityTokenHandler();
        var principal = handler.ValidateToken(idToken, parameters, out _);

        var subject = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
            ?? throw new SecurityTokenException("id_token missing sub claim.");
        var email = principal.FindFirst(JwtRegisteredClaimNames.Email)?.Value;

        return new SocialIdentity(provider, subject, email);
    }

    private static ConfigurationManager<OpenIdConnectConfiguration> Create(string metadataAddress) =>
        new(metadataAddress, new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever());
}
