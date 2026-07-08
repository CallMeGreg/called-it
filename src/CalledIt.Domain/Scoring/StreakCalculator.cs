namespace CalledIt.Domain.Scoring;

/// <summary>One category's result on one resolved day.</summary>
public readonly record struct CategoryDay(string CategoryCode, DayResult Result);

/// <summary>All category results for a single resolved daily set, in drop order.</summary>
public sealed record DailyOutcome(DateTimeOffset DropAtUtc, IReadOnlyList<CategoryDay> Categories);

/// <summary>
/// The heart of "Called It": the pure, deterministic streak + total-score engine.
///
/// Rules (per category, independent of the others):
///   • Correct  → current streak +1 (best updated) AND lifetime total +1
///   • Wrong    → current streak resets to 0 (total unchanged)
///   • Skipped  → streak preserved, not grown (skips are unlimited)
///   • Missed   → current streak resets to 0 (you left the category untouched)
///   • Void     → neutral, no change
///
/// Because "did nothing" on a resolved day maps to <see cref="DayResult.Missed"/> for that
/// category, *missing a day altogether* naturally resets ALL streaks — while the lifetime
/// total score never decreases.
///
/// The calculator is a pure fold over history, so re-running it (e.g. after an admin amends a
/// past outcome) is inherently idempotent: the same history always yields the same state.
/// </summary>
public static class StreakCalculator
{
    /// <summary>Fold a single day's result into a category's running state.</summary>
    public static CategoryState Apply(CategoryState state, DayResult result) => result switch
    {
        DayResult.Correct => state with
        {
            Current = state.Current + 1,
            Best = Math.Max(state.Best, state.Current + 1),
            TotalCorrect = state.TotalCorrect + 1,
        },
        DayResult.Wrong => state with { Current = 0 },
        DayResult.Missed => state with { Current = 0 },
        DayResult.Skipped => state, // preserve
        DayResult.Void => state,    // neutral
        DayResult.Pending => state, // not yet resolved; ignore
        _ => state,
    };

    /// <summary>Replay an ordered sequence of day results for a single category.</summary>
    public static CategoryState Replay(IEnumerable<DayResult> resultsChronological, CategoryState seed = default)
    {
        var state = seed;
        foreach (var r in resultsChronological)
        {
            state = Apply(state, r);
        }

        return state;
    }

    /// <summary>
    /// Replay a full history of daily sets and return the final per-category state for every
    /// category seen. Days are sorted chronologically by drop time before folding.
    /// </summary>
    public static IReadOnlyDictionary<string, CategoryState> Replay(IEnumerable<DailyOutcome> history)
    {
        var states = new Dictionary<string, CategoryState>();

        foreach (var day in history.OrderBy(d => d.DropAtUtc))
        {
            foreach (var cat in day.Categories)
            {
                var current = states.TryGetValue(cat.CategoryCode, out var s) ? s : CategoryState.Empty;
                states[cat.CategoryCode] = Apply(current, cat.Result);
            }
        }

        return states;
    }

    /// <summary>Lifetime total score = sum of correct answers across all categories (never resets).</summary>
    public static int TotalScore(IReadOnlyDictionary<string, CategoryState> states) =>
        states.Values.Sum(s => s.TotalCorrect);

    /// <summary>Overall current-streak board value = sum of every category's current streak.</summary>
    public static int OverallCurrentStreak(IReadOnlyDictionary<string, CategoryState> states) =>
        states.Values.Sum(s => s.Current);
}
