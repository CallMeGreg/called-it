using System.Text.Json;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Application.Scoring;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Questions;

/// <summary>
/// Resolves question outcomes automatically (via <see cref="IResolutionProvider"/>) and lets an
/// admin set or amend any outcome — including previously-resolved ones. Every change is audited
/// and triggers an idempotent streak/score recompute, so no app deployment is ever needed.
/// </summary>
public sealed class ResolutionService
{
    private readonly IAppDbContext _db;
    private readonly IClock _clock;
    private readonly IResolutionProviderRegistry _providers;
    private readonly RecomputeService _recompute;

    public ResolutionService(
        IAppDbContext db,
        IClock clock,
        IResolutionProviderRegistry providers,
        RecomputeService recompute)
    {
        _db = db;
        _clock = clock;
        _providers = providers;
        _recompute = recompute;
    }

    /// <summary>Auto-resolve every due, unresolved question that has a working provider.</summary>
    public async Task<int> ResolveDueAsync(CancellationToken ct = default)
    {
        var now = _clock.UtcNow;
        var due = await _db.Questions
            .Where(q => q.Outcome == Outcome.Unresolved
                        && q.Status == QuestionStatus.Published
                        && q.ResolvesAt <= now)
            .ToListAsync(ct);

        var affectedSets = new HashSet<Guid>();
        var resolved = 0;

        foreach (var question in due)
        {
            if (!_providers.TryGet(question.ResolutionSourceKey, out var provider))
            {
                continue;
            }

            var outcome = await provider.ResolveAsync(question, ct);
            if (outcome == Outcome.Unresolved)
            {
                continue; // data not available yet — try again next tick
            }

            ApplyOutcome(question, outcome, OutcomeSource.Auto, resolvedBy: null, reason: "auto-resolved");
            resolved++;

            foreach (var setId in await SetsContaining(question.Id, ct))
            {
                affectedSets.Add(setId);
            }
        }

        await _db.SaveChangesAsync(ct);

        foreach (var setId in affectedSets)
        {
            await _recompute.RecomputeForDailySetAsync(setId, ct);
        }

        return resolved;
    }

    /// <summary>Admin: set or amend a question's outcome (works on already-resolved questions).</summary>
    public async Task<QuestionView> SetOutcomeAsync(
        Guid adminId, Guid questionId, Outcome outcome, string reason, CancellationToken ct = default)
    {
        if (outcome == Outcome.Unresolved)
        {
            throw new ValidationException("Cannot set an outcome of Unresolved.");
        }

        var question = await _db.Questions.Include(q => q.Category)
            .FirstOrDefaultAsync(q => q.Id == questionId, ct)
            ?? throw new NotFoundException("Question not found.");

        var before = new { question.Outcome, question.OutcomeSource, question.Status };

        ApplyOutcome(question, outcome, OutcomeSource.Manual, adminId, reason);

        _db.AuditLogs.Add(new AuditLog
        {
            ActorId = adminId,
            Action = before.Outcome == Outcome.Unresolved ? "outcome.set" : "outcome.amend",
            EntityType = nameof(Question),
            EntityId = question.Id.ToString(),
            Detail = JsonSerializer.Serialize(new
            {
                before,
                after = new { question.Outcome, question.OutcomeSource, question.Status },
                reason,
            }),
            CreatedAt = _clock.UtcNow,
        });

        await _db.SaveChangesAsync(ct);

        foreach (var setId in await SetsContaining(question.Id, ct))
        {
            await _recompute.RecomputeForDailySetAsync(setId, ct);
        }

        return QuestionService.ToView(question, question.Category!.Code);
    }

    private void ApplyOutcome(Question question, Outcome outcome, OutcomeSource source, Guid? resolvedBy, string reason)
    {
        question.Outcome = outcome;
        question.OutcomeSource = source;
        question.ResolvedBy = resolvedBy;
        question.ResolvedAt = _clock.UtcNow;
        question.Status = outcome == Outcome.Void ? QuestionStatus.Void : QuestionStatus.Resolved;
    }

    private async Task<List<Guid>> SetsContaining(Guid questionId, CancellationToken ct) =>
        await _db.DailySetItems
            .Where(i => i.QuestionId == questionId)
            .Select(i => i.DailySetId)
            .Distinct()
            .ToListAsync(ct);
}
