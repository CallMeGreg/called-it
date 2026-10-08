using CalledIt.Application.Abstractions;
using CalledIt.Domain.Entities;
using CalledIt.Domain.Scoring;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Scoring;

/// <summary>
/// Rebuilds a player's per-category streaks and lifetime scores by replaying their full history
/// through <see cref="StreakCalculator"/>. Because it is a pure replay, running it again after an
/// admin amends a past outcome is inherently idempotent and simply restates the correct values.
/// </summary>
public sealed class RecomputeService
{
    private readonly IAppDbContext _db;
    private readonly IClock _clock;

    public RecomputeService(IAppDbContext db, IClock clock)
    {
        _db = db;
        _clock = clock;
    }

    /// <summary>Recompute every player who was eligible for the given set (incl. non-participants,
    /// since a missed day resets their streaks).</summary>
    public async Task RecomputeForDailySetAsync(Guid dailySetId, CancellationToken ct = default)
    {
        var set = await _db.DailySets.FirstOrDefaultAsync(s => s.Id == dailySetId, ct);
        if (set is null)
        {
            return;
        }

        var eligibleUserIds = await _db.Users
            .Where(u => u.CreatedAt <= set.DropAtUtc)
            .Select(u => u.Id)
            .ToListAsync(ct);

        foreach (var userId in eligibleUserIds)
        {
            await RecomputeForUserAsync(userId, ct);
        }
    }

    public async Task RecomputeForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
        {
            return;
        }

        var now = _clock.UtcNow;

        var sets = await _db.DailySets
            .Include(s => s.Items).ThenInclude(i => i.Question)
            .Where(s => s.DropAtUtc <= now && s.DropAtUtc >= user.CreatedAt)
            .OrderBy(s => s.DropAtUtc)
            .ToListAsync(ct);

        var guesses = await _db.Guesses
            .Where(g => g.UserId == userId)
            .ToListAsync(ct);
        var guessByQuestion = guesses.ToDictionary(g => g.QuestionId);

        var history = sets.Select(set => new DailyOutcome(
            set.DropAtUtc,
            set.Items.Select(i =>
            {
                guessByQuestion.TryGetValue(i.QuestionId, out var g);
                var result = DayResultEvaluator.Evaluate(g?.Pick, g?.IsSkip ?? false, i.Question!.Outcome);
                return new CategoryDay(i.CategoryCode, result);
            }).ToList()))
            .ToList();

        var states = StreakCalculator.Replay(history);

        await PersistAsync(userId, states, ct);
    }

    private async Task PersistAsync(Guid userId, IReadOnlyDictionary<string, CategoryState> states, CancellationToken ct)
    {
        var streaks = await _db.Streaks.Where(s => s.UserId == userId).ToListAsync(ct);
        var scores = await _db.Scores.Where(s => s.UserId == userId).ToListAsync(ct);

        foreach (var (code, state) in states)
        {
            var streak = streaks.FirstOrDefault(s => s.CategoryCode == code);
            if (streak is null)
            {
                streak = new Streak { UserId = userId, CategoryCode = code };
                _db.Streaks.Add(streak);
            }

            streak.Current = state.Current;
            streak.Best = state.Best;
            streak.UpdatedAt = _clock.UtcNow;

            var score = scores.FirstOrDefault(s => s.CategoryCode == code);
            if (score is null)
            {
                score = new Score { UserId = userId, CategoryCode = code };
                _db.Scores.Add(score);
            }

            score.TotalCorrect = state.TotalCorrect;
            score.UpdatedAt = _clock.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
    }
}
