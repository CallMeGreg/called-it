using CalledIt.Api.Infrastructure;
using CalledIt.Application.Identity;
using CalledIt.Application.Questions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api/test")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class TestController(AuthService auth, TestGameService game) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("test-login")]
    [RequestSizeLimit(4096)]
    public async Task<ActionResult<AuthResult>> Login([FromBody] TestLoginRequest request, CancellationToken ct) =>
        Ok(await auth.LoginWithInviteAsync(request.InviteCode, request.DisplayName, ct));

    [HttpGet("game")]
    [Authorize]
    public async Task<ActionResult<TestGameView>> Game(CancellationToken ct) =>
        Ok(await game.GetAsync(User.UserId(), ct));
}

public sealed record TestLoginRequest(string InviteCode, string DisplayName);
