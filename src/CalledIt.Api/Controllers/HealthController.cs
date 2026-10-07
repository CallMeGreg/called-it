using CalledIt.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
public sealed class HealthController : ControllerBase
{
    [HttpGet("/health")]
    public IActionResult Get() => Ok(new { status = "ok", utc = DateTimeOffset.UtcNow });

    [HttpGet("/health/ready")]
    public async Task<IActionResult> Ready([FromServices] AppDbContext db, CancellationToken ct) =>
        await db.Database.CanConnectAsync(ct)
            ? Ok(new { status = "ok" })
            : StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "unavailable" });
}
