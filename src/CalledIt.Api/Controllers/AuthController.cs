using CalledIt.Api.Infrastructure;
using CalledIt.Application.Identity;
using CalledIt.Domain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly AuthService _auth;

    public AuthController(AuthService auth) => _auth = auth;

    /// <summary>Start login/registration by texting a one-time passcode to the phone number.</summary>
    [HttpPost("otp")]
    [AllowAnonymous]
    public async Task<IActionResult> RequestOtp([FromBody] RequestOtpRequest request, CancellationToken ct)
    {
        await _auth.RequestOtpAsync(new RequestOtpCommand(request.PhoneE164), ct);
        return Accepted();
    }

    /// <summary>Complete login/registration: verify the OTP + Apple/Google id_token, get tokens.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResult>> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        var result = await _auth.RegisterOrLoginAsync(new RegisterOrLoginCommand(
            request.PhoneE164,
            request.Code,
            request.Provider,
            request.IdToken,
            request.DisplayName,
            request.Platform,
            request.PushToken), ct);
        return Ok(result);
    }

    /// <summary>Exchange a valid refresh token for a fresh access/refresh pair (rotating).</summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResult>> Refresh([FromBody] RefreshRequest request, CancellationToken ct)
    {
        var result = await _auth.RefreshAsync(request.RefreshToken, ct);
        return Ok(result);
    }

    /// <summary>Register or refresh the caller's device for push notifications.</summary>
    [HttpPost("devices")]
    [Authorize]
    public async Task<IActionResult> RegisterDevice([FromBody] RegisterDeviceRequest request, CancellationToken ct)
    {
        await _auth.UpsertDeviceAsync(User.UserId(), request.Platform, request.PushToken, ct);
        return NoContent();
    }
}

public sealed record RequestOtpRequest(string PhoneE164);

public sealed record LoginRequest(
    string PhoneE164,
    string Code,
    SocialProvider Provider,
    string IdToken,
    string? DisplayName,
    DevicePlatform? Platform,
    string? PushToken);

public sealed record RefreshRequest(string RefreshToken);

public sealed record RegisterDeviceRequest(DevicePlatform Platform, string PushToken);
