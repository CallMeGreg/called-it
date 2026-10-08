using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Infrastructure.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace CalledIt.Application.Tests;

public sealed class OidcSocialTokenValidatorTests : IDisposable
{
    private readonly RSA _rsa = RSA.Create(2048);

    [Theory]
    [InlineData(SocialProvider.Apple)]
    [InlineData(SocialProvider.Google)]
    public async Task Valid_signed_token_returns_unmapped_subject_and_email(SocialProvider provider)
    {
        var validator = Validator();
        var identity = await validator.ValidateAsync(provider, Token(provider));
        Assert.Equal(provider, identity.Provider);
        Assert.Equal("provider-subject", identity.Subject);
        Assert.Equal("player@example.com", identity.Email);
    }

    [Theory]
    [InlineData(SocialProvider.Apple, "audience")]
    [InlineData(SocialProvider.Apple, "issuer")]
    [InlineData(SocialProvider.Apple, "expired")]
    [InlineData(SocialProvider.Apple, "future")]
    [InlineData(SocialProvider.Apple, "signature")]
    [InlineData(SocialProvider.Apple, "unsigned")]
    [InlineData(SocialProvider.Apple, "expiry")]
    [InlineData(SocialProvider.Apple, "subject")]
    [InlineData(SocialProvider.Apple, "blank-subject")]
    [InlineData(SocialProvider.Apple, "malformed")]
    [InlineData(SocialProvider.Google, "audience")]
    [InlineData(SocialProvider.Google, "issuer")]
    [InlineData(SocialProvider.Google, "expired")]
    [InlineData(SocialProvider.Google, "future")]
    [InlineData(SocialProvider.Google, "signature")]
    [InlineData(SocialProvider.Google, "unsigned")]
    [InlineData(SocialProvider.Google, "expiry")]
    [InlineData(SocialProvider.Google, "subject")]
    [InlineData(SocialProvider.Google, "blank-subject")]
    [InlineData(SocialProvider.Google, "malformed")]
    public async Task Invalid_social_tokens_are_explicitly_denied(SocialProvider provider, string flaw)
    {
        using var otherKey = RSA.Create(2048);
        var token = flaw == "malformed" ? "not-a-jwt" : Token(provider, flaw, otherKey);
        var error = await Assert.ThrowsAsync<ForbiddenException>(() => Validator().ValidateAsync(provider, token));
        Assert.Equal("Invalid social identity token.", error.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public void Empty_audience_never_disables_validation(string audience)
    {
        var options = Options.Create(new SocialAuthOptions
        {
            AppleAudience = audience,
            GoogleAudience = "google-app",
        });
        Assert.Throws<InvalidOperationException>(() => new OidcSocialTokenValidator(options));
    }

    [Fact]
    public async Task Unknown_signing_key_requests_metadata_refresh_but_never_accepts_token()
    {
        var metadata = new OpenIdConnectConfiguration();
        var manager = new TestConfigurationManager(metadata);
        var validator = new OidcSocialTokenValidator(Options.Create(Settings()), manager, manager);
        await Assert.ThrowsAsync<ForbiddenException>(() => validator.ValidateAsync(SocialProvider.Google, Token(SocialProvider.Google)));
        Assert.True(manager.RefreshRequested);
    }

    private OidcSocialTokenValidator Validator()
    {
        var metadata = new OpenIdConnectConfiguration();
        metadata.SigningKeys.Add(new RsaSecurityKey(_rsa) { KeyId = "test-key" });
        var manager = new TestConfigurationManager(metadata);
        return new OidcSocialTokenValidator(Options.Create(Settings()), manager, manager);
    }

    private string Token(SocialProvider provider, string? flaw = null, RSA? otherKey = null)
    {
        var issuer = provider == SocialProvider.Apple ? "https://appleid.apple.com" : "https://accounts.google.com";
        var audience = provider == SocialProvider.Apple ? "apple-app" : "google-app";
        var now = DateTime.UtcNow;
        var claims = new List<Claim> { new(JwtRegisteredClaimNames.Email, "player@example.com") };
        if (flaw != "subject")
        {
            claims.Add(new Claim(JwtRegisteredClaimNames.Sub, flaw == "blank-subject" ? " " : "provider-subject"));
        }
        var key = new RsaSecurityKey(flaw == "signature" ? otherKey! : _rsa) { KeyId = "test-key" };
        var token = new JwtSecurityToken(
            issuer: flaw == "issuer" ? "https://wrong-issuer.example" : issuer,
            audience: flaw == "audience" ? "another-application" : audience,
            claims: claims,
            notBefore: flaw == "future" ? now.AddHours(1) : now.AddHours(-1),
            expires: flaw == "expiry" ? null : flaw == "expired" ? now.AddMinutes(-10) : now.AddHours(2),
            signingCredentials: flaw == "unsigned" ? null : new SigningCredentials(key, SecurityAlgorithms.RsaSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static SocialAuthOptions Settings() => new()
    {
        AppleAudience = "apple-app",
        GoogleAudience = "google-app",
    };

    public void Dispose() => _rsa.Dispose();

    private sealed class TestConfigurationManager(OpenIdConnectConfiguration configuration)
        : IConfigurationManager<OpenIdConnectConfiguration>
    {
        public bool RefreshRequested { get; private set; }
        public Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancel) =>
            Task.FromResult(configuration);
        public void RequestRefresh() => RefreshRequested = true;
    }
}
