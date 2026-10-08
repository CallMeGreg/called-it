namespace CalledIt.Workers;

/// <summary>Scheduling knobs for the background jobs (bound from configuration).</summary>
public sealed class WorkerOptions
{
    public const string SectionName = "Workers";

    /// <summary>The daily synchronized drop time, expressed in UTC as "HH:mm".</summary>
    public string DailyDropUtc { get; set; } = "17:00";

    /// <summary>How often the auto-resolver scans for due, unresolved questions.</summary>
    public int ResolverIntervalSeconds { get; set; } = 60;

    /// <summary>How many minutes before the hard lock to send the "window closing" reminder.</summary>
    public int WindowClosingLeadMinutes { get; set; } = 30;

    public bool EnableDailySetBuilder { get; set; }
    public bool EnableResolver { get; set; }
    public bool EnableWindowClosing { get; set; }

    public TimeOnly DropTime =>
        TimeOnly.TryParse(DailyDropUtc, out var t) ? t : new TimeOnly(17, 0);
}
