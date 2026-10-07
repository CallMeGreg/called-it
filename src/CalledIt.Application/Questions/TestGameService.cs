using System.Security.Cryptography;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Application.Scoring;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CalledIt.Application.Questions;

public sealed record TestCategoryStats(
    string CategoryCode, string CategoryName, int CurrentStreak, int BestStreak, int TotalCorrect);

public sealed record TestPlayerStats(int TotalScore, int OverallStreak, IReadOnlyList<TestCategoryStats> Categories);

public sealed record TestGameView(
    DateTimeOffset ServerTimeUtc, DailySetView CurrentRound, DailySetView? PreviousRound, TestPlayerStats Stats);

public sealed class TestGameService(
    IAppDbContext db,
    IClock clock,
    IOptions<TestModeOptions> options,
    ITestModeTransaction transaction,
    DailySetService sets,
    RecomputeService recompute)
{
    public const string ResolutionSourceKey = "test.simulated";

    public Task<TestGameView> GetAsync(Guid userId, CancellationToken ct = default)
    {
        options.Value.RequireEnabled();
        return transaction.ExecuteAsync(async () =>
        {
            if (!await db.Users.AnyAsync(u => u.Id == userId && u.TestInviteId != null, ct))
            {
                throw new ForbiddenException("A TEST invite account is required.");
            }

            var current = await db.DailySets
                .Include(s => s.Items).ThenInclude(i => i.Question)
                .SingleOrDefaultAsync(s => s.IsTest && s.Status == DailySetStatus.Published, ct);

            if (current is not null && current.LocksAtUtc <= clock.UtcNow)
            {
                await ResolveAsync(current, ct);
                current = null;
            }

            // Start at the next request, not at a historical time slot: idle time creates no rounds.
            current ??= await CreateRoundAsync(ct);

            var previousId = await db.DailySets
                .Where(s => s.IsTest && s.Status == DailySetStatus.Completed)
                .OrderByDescending(s => s.DropAtUtc)
                .Select(s => (Guid?)s.Id)
                .FirstOrDefaultAsync(ct);

            var currentView = await sets.GetByIdAsync(current.Id, userId, ct)
                ?? throw new InvalidOperationException("The active TEST round is missing.");
            var previousView = previousId is { } id ? await sets.GetByIdAsync(id, userId, ct) : null;
            var stats = await GetStatsAsync(userId, ct);

            return new TestGameView(clock.UtcNow, currentView, previousView, stats);
        }, ct);
    }

    private async Task<DailySet> CreateRoundAsync(CancellationToken ct)
    {
        var now = clock.UtcNow;
        var round = new DailySet
        {
            IsTest = true,
            DropAtUtc = now,
            LocksAtUtc = now.AddSeconds(options.Value.RoundSeconds),
            Status = DailySetStatus.Published,
        };
        var categories = await db.Categories.ToDictionaryAsync(c => c.Code, ct);

        foreach (var code in Categories.All)
        {
            var category = categories[code];
            var question = new Question
            {
                CategoryId = category.Id,
                Text = code switch
                {
                    Categories.Sports => "[TEST SAMPLE - SIMULATED] Will the Comets beat the Rockets?",
                    Categories.Finance => "[TEST SAMPLE - SIMULATED] Will the fictional Demo Index finish higher?",
                    Categories.PopCulture => "[TEST SAMPLE - SIMULATED] Will the fictional Neon Nights trailer top the chart?",
                    _ => throw new InvalidOperationException("Unknown TEST category."),
                },
                SideALabel = "Yes",
                SideBLabel = "No",
                ResolutionSourceKey = ResolutionSourceKey,
                ResolutionRule = "random-result-after-lock",
                ResolvesAt = round.LocksAtUtc,
                Status = QuestionStatus.Published,
            };
            round.Items.Add(new DailySetItem
            {
                DailySetId = round.Id,
                Question = question,
                QuestionId = question.Id,
                CategoryId = category.Id,
                CategoryCode = code,
            });
        }

        db.DailySets.Add(round);
        await db.SaveChangesAsync(ct);
        return round;
    }

    private async Task ResolveAsync(DailySet round, CancellationToken ct)
    {
        foreach (var item in round.Items)
        {
            var question = item.Question!;
            // Generate only after lock, inside the transaction; no upcoming answer is stored or sent.
            question.Outcome = RandomNumberGenerator.GetInt32(2) == 0 ? Outcome.SideA : Outcome.SideB;
            question.OutcomeSource = OutcomeSource.Auto;
            question.ResolvedAt = clock.UtcNow;
            question.Status = QuestionStatus.Resolved;
        }

        round.Status = DailySetStatus.Completed;
        db.AuditLogs.Add(new AuditLog
        {
            Action = "test.round.resolved",
            EntityType = nameof(DailySet),
            EntityId = round.Id.ToString(),
            Detail = "Simulated TEST results; not real-world predictions.",
            CreatedAt = clock.UtcNow,
        });
        await db.SaveChangesAsync(ct);
        await recompute.RecomputeForDailySetAsync(round.Id, ct);
    }

    private async Task<TestPlayerStats> GetStatsAsync(Guid userId, CancellationToken ct)
    {
        var streaks = await db.Streaks.Where(s => s.UserId == userId)
            .ToDictionaryAsync(s => s.CategoryCode, ct);
        var scores = await db.Scores.Where(s => s.UserId == userId)
            .ToDictionaryAsync(s => s.CategoryCode, ct);
        var categories = Categories.All.Select(code =>
        {
            streaks.TryGetValue(code, out var streak);
            scores.TryGetValue(code, out var score);
            return new TestCategoryStats(code, Categories.DisplayName(code),
                streak?.Current ?? 0, streak?.Best ?? 0, score?.TotalCorrect ?? 0);
        }).ToArray();

        return new TestPlayerStats(categories.Sum(c => c.TotalCorrect), categories.Sum(c => c.CurrentStreak), categories);
    }
}
