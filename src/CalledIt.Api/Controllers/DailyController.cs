using CalledIt.Api.Infrastructure;
using CalledIt.Application.Questions;
using CalledIt.Domain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize]
public sealed class DailyController : ControllerBase
{
    private readonly DailySetService _sets;
    private readonly GuessService _guesses;

    public DailyController(DailySetService sets, GuessService guesses)
    {
        _sets = sets;
        _guesses = guesses;
    }

    /// <summary>Today's card: the current live set with the caller's own picks overlaid.</summary>
    [HttpGet("today")]
    public async Task<ActionResult<DailySetView>> Today(CancellationToken ct)
    {
        var view = await _sets.GetTodayAsync(User.UserId(), ct);
        return view is null ? NotFound() : Ok(view);
    }

    /// <summary>Submit a pick or a skip for a question (rejected after the 6-hour lock).</summary>
    [HttpPost("guesses")]
    public async Task<ActionResult<GuessResult>> Submit([FromBody] SubmitGuessRequest request, CancellationToken ct)
    {
        var result = await _guesses.SubmitAsync(
            User.UserId(), new SubmitGuessCommand(request.QuestionId, request.Pick, request.Skip), ct);
        return Ok(result);
    }
}

public sealed record SubmitGuessRequest(Guid QuestionId, Side? Pick, bool Skip);
