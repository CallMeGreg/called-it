using CalledIt.Domain;

namespace CalledIt.Application.Identity;

/// <summary>Request to start a login/registration by sending a phone OTP.</summary>
public sealed record RequestOtpCommand(string PhoneE164);

/// <summary>
/// Completes registration/login: verifies the phone OTP AND a linked Apple/Google id_token,
/// then issues tokens. Both a verified phone and a social provider are required from day one.
/// </summary>
public sealed record RegisterOrLoginCommand(
    string PhoneE164,
    string Code,
    SocialProvider Provider,
    string IdToken,
    string? DisplayName,
    DevicePlatform? Platform,
    string? PushToken);

public sealed record AuthResult(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    Guid UserId,
    string DisplayName,
    bool IsAdmin);
