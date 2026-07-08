using CalledIt.Api.Infrastructure;
using CalledIt.Application.Notifications;
using CalledIt.Application.Questions;
using CalledIt.Domain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Roles = "Admin")]
public sealed class AdminController : ControllerBase
{
    private readonly QuestionService _questions;
    private readonly DailySetService _sets;
    private readonly ResolutionService _resolution;
    private readonly NotificationService _notifications;

    public AdminController(
        QuestionService questions,
        DailySetService sets,
        ResolutionService resolution,
        NotificationService notifications)
    {
        _questions = questions;
        _sets = sets;
        _resolution = resolution;
        _notifications = notifications;
    }

    /// <summary>Author a question. Requires a machine-readable resolution source + rule.</summary>
    [HttpPost("questions")]
    public async Task<ActionResult<QuestionView>> CreateQuestion(
        [FromBody] CreateQuestionCommand command, CancellationToken ct) =>
        Ok(await _questions.CreateAsync(command, ct));

    /// <summary>List questions, optionally filtered by status.</summary>
    [HttpGet("questions")]
    public async Task<ActionResult<IReadOnlyList<QuestionView>>> ListQuestions(
        [FromQuery] QuestionStatus? status, CancellationToken ct) =>
        Ok(await _questions.ListAsync(status, ct));

    /// <summary>Build and publish the synchronized global set that drops at the given instant.</summary>
    [HttpPost("daily-sets")]
    public async Task<ActionResult<DailySetView>> BuildDailySet(
        [FromBody] BuildDailySetRequest request, CancellationToken ct) =>
        Ok(await _sets.BuildAsync(request.DropAtUtc, ct));

    /// <summary>Set or amend a question's outcome (works on already-resolved questions).</summary>
    [HttpPost("questions/{questionId:guid}/outcome")]
    public async Task<ActionResult<QuestionView>> SetOutcome(
        Guid questionId, [FromBody] SetOutcomeRequest request, CancellationToken ct) =>
        Ok(await _resolution.SetOutcomeAsync(User.UserId(), questionId, request.Outcome, request.Reason, ct));

    /// <summary>Run auto-resolution for all due, unresolved questions with a working provider.</summary>
    [HttpPost("resolve-due")]
    public async Task<ActionResult<object>> ResolveDue(CancellationToken ct)
    {
        var resolved = await _resolution.ResolveDueAsync(ct);
        return Ok(new { resolved });
    }

    /// <summary>Manually broadcast the "today's drop" push (normally the worker does this).</summary>
    [HttpPost("notifications/drop")]
    public async Task<IActionResult> BroadcastDrop([FromBody] BroadcastDropRequest request, CancellationToken ct)
    {
        await _notifications.BroadcastDropAsync(request.DailySetId, ct);
        return Accepted();
    }
}

public sealed record BuildDailySetRequest(DateTimeOffset DropAtUtc);

public sealed record SetOutcomeRequest(Outcome Outcome, string Reason);

public sealed record BroadcastDropRequest(Guid DailySetId);
