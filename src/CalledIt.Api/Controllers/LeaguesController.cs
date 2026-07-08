using CalledIt.Api.Infrastructure;
using CalledIt.Application.Social;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api/leagues")]
[Authorize]
public sealed class LeaguesController : ControllerBase
{
    private readonly LeagueService _leagues;

    public LeaguesController(LeagueService leagues) => _leagues = leagues;

    /// <summary>Create a league; the caller becomes owner and first member.</summary>
    [HttpPost]
    public async Task<ActionResult<LeagueView>> Create([FromBody] CreateLeagueRequest request, CancellationToken ct) =>
        Ok(await _leagues.CreateAsync(User.UserId(), request.Name, ct));

    /// <summary>Join a league by its short code.</summary>
    [HttpPost("join")]
    public async Task<ActionResult<LeagueView>> Join([FromBody] JoinLeagueRequest request, CancellationToken ct) =>
        Ok(await _leagues.JoinAsync(User.UserId(), request.JoinCode, ct));

    /// <summary>List the leagues the caller belongs to.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<LeagueView>>> Mine(CancellationToken ct) =>
        Ok(await _leagues.ListMyLeaguesAsync(User.UserId(), ct));

    /// <summary>List members of a league.</summary>
    [HttpGet("{leagueId:guid}/members")]
    public async Task<ActionResult<IReadOnlyList<LeagueMemberView>>> Members(Guid leagueId, CancellationToken ct) =>
        Ok(await _leagues.ListMembersAsync(leagueId, ct));
}

public sealed record CreateLeagueRequest(string Name);

public sealed record JoinLeagueRequest(string JoinCode);
