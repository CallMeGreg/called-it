namespace CalledIt.Domain;

/// <summary>The two sides of a binary question (yes/no, win/lose, over/under).</summary>
public enum Side
{
    A = 0,
    B = 1,
}

/// <summary>Resolved outcome of a question.</summary>
public enum Outcome
{
    Unresolved = 0,
    SideA = 1,
    SideB = 2,
    Void = 3,
}

/// <summary>Answer type. v1 is binary only; kept as an enum for post-MVP expansion.</summary>
public enum AnswerType
{
    Binary = 0,
}

/// <summary>How an outcome was set.</summary>
public enum OutcomeSource
{
    None = 0,
    Auto = 1,
    Manual = 2,
}

public enum QuestionStatus
{
    Draft = 0,
    Approved = 1,
    Published = 2,
    Resolved = 3,
    Void = 4,
}

public enum DailySetStatus
{
    Scheduled = 0,
    Published = 1,
}

public enum SocialProvider
{
    Apple = 0,
    Google = 1,
}

/// <summary>Client platform. v1 is iOS only; kept as an enum for post-MVP expansion.</summary>
public enum DevicePlatform
{
    iOS = 0,
}

public enum FriendshipStatus
{
    Pending = 0,
    Accepted = 1,
}

/// <summary>
/// The per-category, per-day evaluation used by the streak/score engine.
/// </summary>
public enum DayResult
{
    /// <summary>Question not resolved yet — must not be folded into streak state.</summary>
    Pending = 0,

    /// <summary>Correct pick: streak +1 and total score +1.</summary>
    Correct = 1,

    /// <summary>Wrong pick: this category's streak resets to 0 (total score unchanged).</summary>
    Wrong = 2,

    /// <summary>Player skipped: streak preserved, not grown. Skips are unlimited.</summary>
    Skipped = 3,

    /// <summary>Player did nothing for this category on a resolved day: streak resets to 0.</summary>
    Missed = 4,

    /// <summary>Question was voided/cancelled: neutral for everyone (no streak change).</summary>
    Void = 5,
}
