using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Questions;

public sealed record SubmitGuessCommand(Guid QuestionId, Side? Pick, bool Skip);

public sealed record GuessResult(Guid QuestionId, string CategoryCode, Side? Pick, bool IsSkip, DateTimeOffset SubmittedAt);

/// <summary>
/// Accepts a player's pick or skip for a question, enforcing the hard, server-authoritative
/// 6-hour lock: nothing can be submitted or changed once the daily set's window closes.
/// </summary>
public sealed class GuessService
{
    private readonly IAppDbContext _db;
    private readonly IClock _clock;

    public GuessService(IAppDbContext db, IClock clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<GuessResult> SubmitAsync(Guid userId, SubmitGuessCommand cmd, CancellationToken ct = default)
    {
        if (cmd.Skip && cmd.Pick is not null)
        {
            throw new ValidationException("A guess is either a pick or a skip, not both.");
        }

        if (!cmd.Skip && cmd.Pick is null)
        {
            throw new ValidationException("Provide a pick, or set skip = true.");
        }

        var item = await _db.DailySetItems
            .Include(i => i.DailySet)
            .FirstOrDefaultAsync(i => i.QuestionId == cmd.QuestionId, ct)
            ?? throw new NotFoundException("Question is not part of any daily set.");

        var set = item.DailySet!;
        if (!set.IsOpenAt(_clock.UtcNow))
        {
            throw new SubmissionLockedException();
        }

        var guess = await _db.Guesses.FirstOrDefaultAsync(g => g.UserId == userId && g.QuestionId == cmd.QuestionId, ct);
        if (guess is null)
        {
            guess = new Guess
            {
                UserId = userId,
                DailySetId = set.Id,
                QuestionId = cmd.QuestionId,
                CategoryCode = item.CategoryCode,
            };
            _db.Guesses.Add(guess);
        }

        guess.Pick = cmd.Skip ? null : cmd.Pick;
        guess.IsSkip = cmd.Skip;
        guess.SubmittedAt = _clock.UtcNow;

        await _db.SaveChangesAsync(ct);

        return new GuessResult(guess.QuestionId, guess.CategoryCode, guess.Pick, guess.IsSkip, guess.SubmittedAt);
    }
}
