namespace CalledIt.Domain.Scoring;

/// <summary>
/// Turns a player's guess (a pick, a skip, or nothing) plus the resolved outcome into the
/// per-category <see cref="DayResult"/> that the streak engine folds over.
/// </summary>
public static class DayResultEvaluator
{
    /// <param name="pick">The side the player chose, or null if they made no pick.</param>
    /// <param name="isSkip">True if the player explicitly skipped this category.</param>
    /// <param name="outcome">The resolved outcome of the question.</param>
    public static DayResult Evaluate(Side? pick, bool isSkip, Outcome outcome)
    {
        // A voided/cancelled question is neutral for everyone, regardless of what they did.
        if (outcome == Outcome.Void)
        {
            return DayResult.Void;
        }

        // Not resolved yet — caller must not fold this into streak state.
        if (outcome == Outcome.Unresolved)
        {
            return DayResult.Pending;
        }

        // An explicit skip preserves the streak (skips are unlimited).
        if (isSkip)
        {
            return DayResult.Skipped;
        }

        // No pick and no skip on a resolved day == missing this category == reset.
        if (pick is null)
        {
            return DayResult.Missed;
        }

        var correct =
            (outcome == Outcome.SideA && pick == Side.A) ||
            (outcome == Outcome.SideB && pick == Side.B);

        return correct ? DayResult.Correct : DayResult.Wrong;
    }
}
