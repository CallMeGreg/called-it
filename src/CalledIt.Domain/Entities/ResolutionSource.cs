namespace CalledIt.Domain.Entities;

/// <summary>
/// A machine-readable data source that can automatically confirm a question's outcome
/// (e.g. a sports-scores API, a market-data API). Every question must reference one.
/// </summary>
public class ResolutionSource
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Stable key referenced by questions, e.g. "sports.scores.v1".</summary>
    public string Key { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;
}
