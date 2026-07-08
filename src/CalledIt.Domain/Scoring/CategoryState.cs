namespace CalledIt.Domain.Scoring;

/// <summary>
/// Immutable per-category state: the current streak, the best (longest) streak ever,
/// and the lifetime count of correct answers (which never resets).
/// </summary>
public readonly record struct CategoryState(int Current, int Best, int TotalCorrect)
{
    public static readonly CategoryState Empty = new(0, 0, 0);
}
