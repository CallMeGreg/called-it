using CalledIt.Application.Scoring;
using CalledIt.Domain;

namespace CalledIt.Application.Tests;

/// <summary>
/// End-to-end scoring behaviour through the real services and database: auto-resolution feeds the
/// streak/total engine, an admin amend re-runs an idempotent recompute, and a missed day resets
/// every streak while the lifetime Total Score is preserved (the game's crown-jewel rule §6e).
/// </summary>
public sealed class ResolutionRecomputeTests
{
    [Fact]
    public async Task Correct_pick_after_auto_resolution_scores_one_and_starts_a_streak()
    {
        using var app = new TestApp();
        var user = await app.AddUserAsync("+15552220001");

        var set = await app.BuildSetWithQuestionsAsync(
            drop: DateTimeOffset.UtcNow.AddMinutes(-1),
            resolvesAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            rule: "outcome=a");

        var sports = set.Questions.First(q => q.CategoryCode == Categories.Sports);
        await app.SubmitAsync(user, sports.QuestionId, Side.A); // correct

        var resolved = await app.ResolveDueAsync();
        Assert.Equal(3, resolved); // all three questions were due

        Assert.Equal(1, await app.ScoreAsync(user, BoardType.TotalScore));
        Assert.Equal(1, await app.ScoreAsync(user, BoardType.CategoryStreak, Categories.Sports));
        // Untouched categories were "missed", so no streak.
        Assert.Equal(0, await app.ScoreAsync(user, BoardType.CategoryStreak, Categories.Finance));
    }

    [Fact]
    public async Task Admin_amend_flips_the_result_and_recompute_is_idempotent()
    {
        using var app = new TestApp();
        var admin = await app.AddUserAsync("+15555550100", name: "Admin");
        var user = await app.AddUserAsync("+15552220002");

        var set = await app.BuildSetWithQuestionsAsync(
            drop: DateTimeOffset.UtcNow.AddMinutes(-1),
            resolvesAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            rule: "outcome=a");

        var sports = set.Questions.First(q => q.CategoryCode == Categories.Sports);
        await app.SubmitAsync(user, sports.QuestionId, Side.A); // bet on A
        await app.ResolveDueAsync();
        Assert.Equal(1, await app.ScoreAsync(user, BoardType.TotalScore));

        // Admin amends the outcome to B → the user is now wrong.
        await app.SetOutcomeAsync(admin, sports.QuestionId, Outcome.SideB);
        Assert.Equal(0, await app.ScoreAsync(user, BoardType.TotalScore));
        Assert.Equal(0, await app.ScoreAsync(user, BoardType.CategoryStreak, Categories.Sports));

        // Amending back to A restates the correct value — recompute is a pure replay.
        await app.SetOutcomeAsync(admin, sports.QuestionId, Outcome.SideA);
        Assert.Equal(1, await app.ScoreAsync(user, BoardType.TotalScore));
        Assert.Equal(1, await app.ScoreAsync(user, BoardType.CategoryStreak, Categories.Sports));
    }

    [Fact]
    public async Task Missed_day_resets_streaks_but_total_score_is_preserved()
    {
        using var app = new TestApp();
        var user = await app.AddUserAsync("+15552220003", createdAt: DateTimeOffset.UtcNow.AddDays(-1));

        // Three sequential drops, all still inside their (open) window so the player can answer the
        // first two; ordering for the streak engine is by drop time.
        var day1 = await app.BuildSetWithQuestionsAsync(
            DateTimeOffset.UtcNow.AddMinutes(-10), DateTimeOffset.UtcNow.AddMinutes(-1));
        var day2 = await app.BuildSetWithQuestionsAsync(
            DateTimeOffset.UtcNow.AddMinutes(-6), DateTimeOffset.UtcNow.AddMinutes(-1));
        var day3 = await app.BuildSetWithQuestionsAsync(
            DateTimeOffset.UtcNow.AddMinutes(-2), DateTimeOffset.UtcNow.AddMinutes(-1));

        // Answer every question correctly on days 1 and 2.
        foreach (var q in day1.Questions) await app.SubmitAsync(user, q.QuestionId, Side.A);
        foreach (var q in day2.Questions) await app.SubmitAsync(user, q.QuestionId, Side.A);
        // Day 3: the player answers nothing — a missed day.

        await app.ResolveDueAsync();

        // 3 correct on day1 + 3 correct on day2 = 6 lifetime, which never resets.
        Assert.Equal(6, await app.ScoreAsync(user, BoardType.TotalScore));
        // But the missed day zeroes every current streak...
        Assert.Equal(0, await app.ScoreAsync(user, BoardType.CategoryStreak, Categories.Sports));
        Assert.Equal(0, await app.ScoreAsync(user, BoardType.OverallStreak));
        // ...while the best-ever streak (2) is remembered.
        Assert.Equal(2, await app.ScoreAsync(user, BoardType.CategoryBestStreak, Categories.Sports));
    }
}
