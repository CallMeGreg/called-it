namespace CalledIt.Domain.Entities;

/// <summary>
/// A single binary question. Must declare a resolution source + rule so it is
/// auto-resolvable by default; an admin can still set or amend the outcome later.
/// </summary>
public class Question
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }

    public string Text { get; set; } = string.Empty;

    /// <summary>Label for <see cref="Side.A"/> (e.g. "Yes", "Home win", "Over").</summary>
    public string SideALabel { get; set; } = "Yes";

    /// <summary>Label for <see cref="Side.B"/> (e.g. "No", "Away win", "Under").</summary>
    public string SideBLabel { get; set; } = "No";

    public AnswerType AnswerType { get; set; } = AnswerType.Binary;

    // --- Auto-resolution (required by default) ---
    public string ResolutionSourceKey { get; set; } = string.Empty;

    /// <summary>Machine-readable rule the resolver applies to the source data.</summary>
    public string ResolutionRule { get; set; } = string.Empty;

    public DateTimeOffset ResolvesAt { get; set; }

    // --- Outcome ---
    public Outcome Outcome { get; set; } = Outcome.Unresolved;
    public OutcomeSource OutcomeSource { get; set; } = OutcomeSource.None;
    public Guid? ResolvedBy { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }

    public QuestionStatus Status { get; set; } = QuestionStatus.Draft;

    public bool IsResolved => Outcome != Outcome.Unresolved;

    /// <summary>True if the question declares a valid auto-resolution source + rule.</summary>
    public bool IsAutoResolvable =>
        !string.IsNullOrWhiteSpace(ResolutionSourceKey) && !string.IsNullOrWhiteSpace(ResolutionRule);
}
