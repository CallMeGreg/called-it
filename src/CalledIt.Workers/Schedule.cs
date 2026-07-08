namespace CalledIt.Workers;

/// <summary>Shared time helpers for the scheduled workers (all times are UTC).</summary>
internal static class Schedule
{
    /// <summary>The next UTC instant at which the clock shows <paramref name="timeUtc"/>.</summary>
    public static DateTimeOffset NextOccurrence(TimeOnly timeUtc, DateTimeOffset nowUtc)
    {
        var today = new DateTimeOffset(
            nowUtc.Year, nowUtc.Month, nowUtc.Day,
            timeUtc.Hour, timeUtc.Minute, 0, TimeSpan.Zero);

        return today > nowUtc ? today : today.AddDays(1);
    }
}
