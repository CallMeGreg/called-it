using CalledIt.Domain;
using CalledIt.Domain.Scoring;
using Xunit;

namespace CalledIt.Domain.Tests;

public class StreakCalculatorTests
{
    [Fact]
    public void Correct_increments_current_best_and_total()
    {
        var s = new CategoryState(Current: 5, Best: 7, TotalCorrect: 10);
        var next = StreakCalculator.Apply(s, DayResult.Correct);

        Assert.Equal(6, next.Current);
        Assert.Equal(7, next.Best);          // 6 < 7, best unchanged
        Assert.Equal(11, next.TotalCorrect); // total climbs
    }

    [Fact]
    public void Correct_updates_best_when_current_exceeds_it()
    {
        var s = new CategoryState(Current: 7, Best: 7, TotalCorrect: 10);
        var next = StreakCalculator.Apply(s, DayResult.Correct);

        Assert.Equal(8, next.Current);
        Assert.Equal(8, next.Best);
    }

    [Fact]
    public void Wrong_resets_current_but_keeps_best_and_total()
    {
        var s = new CategoryState(Current: 12, Best: 12, TotalCorrect: 40);
        var next = StreakCalculator.Apply(s, DayResult.Wrong);

        Assert.Equal(0, next.Current);
        Assert.Equal(12, next.Best);
        Assert.Equal(40, next.TotalCorrect); // total never drops
    }

    [Fact]
    public void Skip_preserves_everything()
    {
        var s = new CategoryState(Current: 13, Best: 13, TotalCorrect: 41);
        Assert.Equal(s, StreakCalculator.Apply(s, DayResult.Skipped));
    }

    [Fact]
    public void Missed_resets_current_but_keeps_total()
    {
        var s = new CategoryState(Current: 13, Best: 20, TotalCorrect: 41);
        var next = StreakCalculator.Apply(s, DayResult.Missed);

        Assert.Equal(0, next.Current);
        Assert.Equal(20, next.Best);
        Assert.Equal(41, next.TotalCorrect);
    }

    [Fact]
    public void Void_is_neutral()
    {
        var s = new CategoryState(Current: 9, Best: 9, TotalCorrect: 30);
        Assert.Equal(s, StreakCalculator.Apply(s, DayResult.Void));
    }

    [Fact]
    public void Missing_a_day_altogether_resets_all_streaks_but_not_total()
    {
        // Three categories mid-streak.
        var states = new Dictionary<string, CategoryState>
        {
            [Categories.Sports] = new(12, 12, 25),
            [Categories.Finance] = new(3, 3, 15),
            [Categories.PopCulture] = new(0, 4, 8),
        };

        // A fully-missed day = every category gets DayResult.Missed.
        var afterMissedDay = states.ToDictionary(
            kv => kv.Key,
            kv => StreakCalculator.Apply(kv.Value, DayResult.Missed));

        Assert.All(afterMissedDay.Values, cs => Assert.Equal(0, cs.Current));      // all streaks wiped
        Assert.Equal(48, StreakCalculator.TotalScore(afterMissedDay));             // 25+15+8 unchanged
        Assert.Equal(0, StreakCalculator.OverallCurrentStreak(afterMissedDay));    // overall board = 0
    }

    /// <summary>
    /// Encodes the exact worked example from the architecture doc (§6e):
    /// start Sports 12 / Finance 3 / Pop 0, Total 40 → Mon..Thu, with a fully-missed
    /// Wednesday that wipes every streak while the Total holds at 44 and then climbs.
    /// </summary>
    [Fact]
    public void WorkedExample_from_spec_section_6e()
    {
        // Seed: per-category totals chosen to sum to the doc's starting Total score of 40.
        var sports = new CategoryState(Current: 12, Best: 12, TotalCorrect: 25);
        var finance = new CategoryState(Current: 3, Best: 3, TotalCorrect: 15);
        var pop = new CategoryState(Current: 0, Best: 0, TotalCorrect: 0);

        int Total() => sports.TotalCorrect + finance.TotalCorrect + pop.TotalCorrect;
        Assert.Equal(40, Total());

        // Monday: Sports ✅ / Finance ❌ / Pop ✅
        sports = StreakCalculator.Apply(sports, DayResult.Correct);
        finance = StreakCalculator.Apply(finance, DayResult.Wrong);
        pop = StreakCalculator.Apply(pop, DayResult.Correct);
        Assert.Equal(13, sports.Current);
        Assert.Equal(0, finance.Current);
        Assert.Equal(1, pop.Current);
        Assert.Equal(42, Total());

        // Tuesday: Sports ⏭️ Skip / Finance ✅ / Pop ✅
        sports = StreakCalculator.Apply(sports, DayResult.Skipped);
        finance = StreakCalculator.Apply(finance, DayResult.Correct);
        pop = StreakCalculator.Apply(pop, DayResult.Correct);
        Assert.Equal(13, sports.Current); // skip preserved the 13
        Assert.Equal(1, finance.Current);
        Assert.Equal(2, pop.Current);
        Assert.Equal(44, Total());

        // Wednesday: missed the day entirely → ALL streaks reset, Total unchanged.
        sports = StreakCalculator.Apply(sports, DayResult.Missed);
        finance = StreakCalculator.Apply(finance, DayResult.Missed);
        pop = StreakCalculator.Apply(pop, DayResult.Missed);
        Assert.Equal(0, sports.Current);
        Assert.Equal(0, finance.Current);
        Assert.Equal(0, pop.Current);
        Assert.Equal(44, Total()); // held flat through the missed day

        // Thursday: Sports ✅ / Finance ⏭️ Skip / Pop ✅
        sports = StreakCalculator.Apply(sports, DayResult.Correct);
        finance = StreakCalculator.Apply(finance, DayResult.Skipped);
        pop = StreakCalculator.Apply(pop, DayResult.Correct);
        Assert.Equal(1, sports.Current);
        Assert.Equal(0, finance.Current);
        Assert.Equal(1, pop.Current);
        Assert.Equal(46, Total());

        // Best streaks tracked the peaks along the way.
        Assert.Equal(13, sports.Best);
        Assert.Equal(3, finance.Best);
        Assert.Equal(2, pop.Best);
    }

    [Fact]
    public void Replay_over_history_is_idempotent()
    {
        var history = new List<DailyOutcome>
        {
            Day(1, DayResult.Correct, DayResult.Wrong, DayResult.Correct),
            Day(2, DayResult.Skipped, DayResult.Correct, DayResult.Correct),
            Day(3, DayResult.Missed, DayResult.Missed, DayResult.Missed),
            Day(4, DayResult.Correct, DayResult.Skipped, DayResult.Correct),
        };

        var first = StreakCalculator.Replay(history);
        var second = StreakCalculator.Replay(history);

        Assert.Equal(first[Categories.Sports], second[Categories.Sports]);
        Assert.Equal(first[Categories.Finance], second[Categories.Finance]);
        Assert.Equal(first[Categories.PopCulture], second[Categories.PopCulture]);

        // Sanity: final currents match the worked-example shape (from an empty seed).
        Assert.Equal(1, first[Categories.Sports].Current);
        Assert.Equal(0, first[Categories.Finance].Current);
        Assert.Equal(1, first[Categories.PopCulture].Current);
    }

    [Fact]
    public void Replay_orders_days_by_drop_time_regardless_of_input_order()
    {
        var outOfOrder = new List<DailyOutcome>
        {
            Day(3, DayResult.Missed, DayResult.Missed, DayResult.Missed),
            Day(1, DayResult.Correct, DayResult.Correct, DayResult.Correct),
            Day(2, DayResult.Correct, DayResult.Correct, DayResult.Correct),
        };

        var states = StreakCalculator.Replay(outOfOrder);
        // Days 1&2 correct then day 3 missed → current 0, best 2, total 2 per category.
        foreach (var code in Categories.All)
        {
            Assert.Equal(0, states[code].Current);
            Assert.Equal(2, states[code].Best);
            Assert.Equal(2, states[code].TotalCorrect);
        }
    }

    private static DailyOutcome Day(int dayNumber, DayResult sports, DayResult finance, DayResult pop) =>
        new(
            new DateTimeOffset(2026, 1, dayNumber, 12, 0, 0, TimeSpan.Zero),
            new[]
            {
                new CategoryDay(Categories.Sports, sports),
                new CategoryDay(Categories.Finance, finance),
                new CategoryDay(Categories.PopCulture, pop),
            });
}
