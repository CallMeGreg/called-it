namespace CalledIt.Domain.Entities;

/// <summary>
/// One globally-synchronized daily drop: exactly three questions (one Sports, one Finance,
/// one Pop Culture), released to everyone at <see cref="DropAtUtc"/> with a hard lock at
/// <see cref="LocksAtUtc"/> = drop + 6 hours.
/// </summary>
public class DailySet
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public DateTimeOffset DropAtUtc { get; set; }
    public DateTimeOffset LocksAtUtc { get; set; }

    public DailySetStatus Status { get; set; } = DailySetStatus.Scheduled;

    public ICollection<DailySetItem> Items { get; set; } = new List<DailySetItem>();

    /// <summary>The submission window is open only between drop and lock (inclusive of drop).</summary>
    public bool IsOpenAt(DateTimeOffset now) => now >= DropAtUtc && now < LocksAtUtc;
}

/// <summary>A question slotted into a daily set for a given category.</summary>
public class DailySetItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DailySetId { get; set; }
    public DailySet? DailySet { get; set; }

    public Guid QuestionId { get; set; }
    public Question? Question { get; set; }

    public Guid CategoryId { get; set; }
    public string CategoryCode { get; set; } = string.Empty;
}
