using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CalledIt.Application.Questions;

/// <summary>
/// Builds the one synchronized global daily set (one Sports, one Finance, one Pop Culture) and
/// serves "today's card" to clients with the caller's own picks overlaid.
/// </summary>
public sealed class DailySetService
{
    private readonly IAppDbContext _db;
    private readonly IClock _clock;
    private readonly GameOptions _game;

    public DailySetService(IAppDbContext db, IClock clock, IOptions<GameOptions> game)
    {
        _db = db;
        _clock = clock;
        _game = game.Value;
    }

    /// <summary>Assemble and publish the daily set that drops at <paramref name="dropAtUtc"/>.</summary>
    public async Task<DailySetView> BuildAsync(DateTimeOffset dropAtUtc, CancellationToken ct = default)
    {
        var locksAt = dropAtUtc.AddHours(_game.SubmissionWindowHours);

        var set = new DailySet
        {
            DropAtUtc = dropAtUtc,
            LocksAtUtc = locksAt,
            Status = DailySetStatus.Published,
        };

        foreach (var code in Categories.All)
        {
            var question = await PickApprovedUnusedQuestionAsync(code, ct)
                ?? throw new ValidationException($"No approved, unused question available for '{code}'.");

            question.Status = QuestionStatus.Published;
            set.Items.Add(new DailySetItem
            {
                DailySetId = set.Id,
                QuestionId = question.Id,
                CategoryId = question.CategoryId,
                CategoryCode = code,
            });
        }

        _db.DailySets.Add(set);
        await _db.SaveChangesAsync(ct);

        return await GetByIdAsync(set.Id, userId: null, ct)
            ?? throw new NotFoundException("Failed to load the set just created.");
    }

    /// <summary>The current card: the most recent set that has already dropped.</summary>
    public async Task<DailySetView?> GetTodayAsync(Guid? userId, CancellationToken ct = default)
    {
        var now = _clock.UtcNow;
        var set = await _db.DailySets
            .Where(s => s.DropAtUtc <= now)
            .OrderByDescending(s => s.DropAtUtc)
            .FirstOrDefaultAsync(ct);

        return set is null ? null : await GetByIdAsync(set.Id, userId, ct);
    }

    public async Task<DailySetView?> GetByIdAsync(Guid setId, Guid? userId, CancellationToken ct = default)
    {
        var set = await _db.DailySets
            .Include(s => s.Items).ThenInclude(i => i.Question)
            .FirstOrDefaultAsync(s => s.Id == setId, ct);

        if (set is null)
        {
            return null;
        }

        var myGuesses = new Dictionary<Guid, Guess>();
        if (userId is { } uid)
        {
            var guesses = await _db.Guesses
                .Where(g => g.UserId == uid && g.DailySetId == setId)
                .ToListAsync(ct);
            myGuesses = guesses.ToDictionary(g => g.QuestionId);
        }

        var questions = set.Items
            .OrderBy(i => Categories.All.ToList().IndexOf(i.CategoryCode))
            .Select(i =>
            {
                myGuesses.TryGetValue(i.QuestionId, out var g);
                return new DailySetQuestionView(
                    i.QuestionId,
                    i.CategoryCode,
                    Categories.DisplayName(i.CategoryCode),
                    i.Question!.Text,
                    i.Question.SideALabel,
                    i.Question.SideBLabel,
                    g?.Pick,
                    g?.IsSkip ?? false,
                    i.Question.Outcome.ToString());
            })
            .ToList();

        return new DailySetView(set.Id, set.DropAtUtc, set.LocksAtUtc, set.IsOpenAt(_clock.UtcNow), questions);
    }

    private async Task<Question?> PickApprovedUnusedQuestionAsync(string categoryCode, CancellationToken ct)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Code == categoryCode, ct);
        if (category is null)
        {
            return null;
        }

        var usedQuestionIds = _db.DailySetItems.Select(i => i.QuestionId);

        return await _db.Questions
            .Where(q => q.CategoryId == category.Id
                        && q.Status == QuestionStatus.Approved
                        && !usedQuestionIds.Contains(q.Id))
            .OrderBy(q => q.ResolvesAt)
            .FirstOrDefaultAsync(ct);
    }
}
