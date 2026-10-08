using CalledIt.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class HealthController : ControllerBase
{
    [HttpGet("/health")]
    [HttpGet("/health/live")]
    public IActionResult Get() => Ok(new { status = "ok", utc = DateTimeOffset.UtcNow });

    [HttpGet("/health/ready")]
    public async Task<IActionResult> Ready([FromServices] DatabaseReadiness readiness, CancellationToken ct)
    {
        if (!await readiness.IsReadyAsync(ct))
        {
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Service unavailable", detail: "The database is not ready.");
        }

        return Ok(new { status = "ok", utc = DateTimeOffset.UtcNow });
    }
}
