using CalledIt.Domain.Entities;

namespace CalledIt.Application.Abstractions;

/// <summary>Issues signed JWT access tokens for authenticated users.</summary>
public interface ITokenService
{
    /// <summary>Create a signed, short-lived access token carrying the user's id and admin role.</summary>
    AccessToken CreateAccessToken(User user);

    /// <summary>Generate a new opaque refresh token value (returned once, stored only as a hash).</summary>
    string GenerateRefreshTokenValue();

    /// <summary>Hash an opaque refresh token value for storage/lookup.</summary>
    string HashRefreshToken(string value);
}

public sealed record AccessToken(string Token, DateTimeOffset ExpiresAt);
