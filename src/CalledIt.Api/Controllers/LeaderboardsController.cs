using CalledIt.Api.Infrastructure;
using CalledIt.Application.Scoring;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api/leaderboards")]
[Authorize]
public sealed class LeaderboardsController : ControllerBase
{
    private readonly LeaderboardService _boards;

    public LeaderboardsController(LeaderboardService boards) => _boards = boards;

    /// <summary>
    /// Read a leaderboard. <paramref name="type"/> selects the metric (per-category streak/best,
    /// overall streak, or total score); <paramref name="scope"/> is Global or Friends.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<LeaderboardResult>> Get(
        [FromQuery] BoardType type = BoardType.TotalScore,
        [FromQuery] BoardScope scope = BoardScope.Global,
        [FromQuery] string? category = null,
        [FromQuery] int count = 50,
        CancellationToken ct = default)
    {
        var result = await _boards.GetAsync(type, scope, User.UserId(), category, Math.Clamp(count, 1, 200), ct);
        return Ok(result);
    }
}
