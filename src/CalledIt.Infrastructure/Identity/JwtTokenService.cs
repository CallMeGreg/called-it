using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace CalledIt.Infrastructure.Identity;

/// <summary>Issues HS256-signed JWT access tokens and opaque refresh-token values.</summary>
public sealed class JwtTokenService : ITokenService
{
    public const string AdminRole = "Admin";

    private readonly AuthOptions _auth;
    private readonly IClock _clock;

    public JwtTokenService(IOptions<AuthOptions> auth, IClock clock)
    {
        _auth = auth.Value;
        _clock = clock;
    }

    public AccessToken CreateAccessToken(User user)
    {
        var expires = _clock.UtcNow.AddMinutes(_auth.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new("name", user.DisplayName),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        if (user.TestInviteId is not null)
        {
            claims.Add(new Claim(TestModeOptions.InviteClaim, user.TestInviteId));
        }

        if (user.IsAdmin)
        {
            claims.Add(new Claim(ClaimTypes.Role, AdminRole));
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(GetSigningKey()));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _auth.Issuer,
            audience: _auth.Audience,
            claims: claims,
            notBefore: _clock.UtcNow.UtcDateTime,
            expires: expires.UtcDateTime,
            signingCredentials: creds);

        var jwt = new JwtSecurityTokenHandler().WriteToken(token);
        return new AccessToken(jwt, expires);
    }

    public string GenerateRefreshTokenValue()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Base64UrlEncoder.Encode(bytes);
    }

    public string HashRefreshToken(string value) => Hashing.Sha256Hex(value);

    private string GetSigningKey()
    {
        if (string.IsNullOrWhiteSpace(_auth.SigningKey) || _auth.SigningKey.Length < 32)
        {
            throw new InvalidOperationException(
                "Auth:SigningKey must be configured with at least 32 characters (use Key Vault in production).");
        }

        return _auth.SigningKey;
    }
}
