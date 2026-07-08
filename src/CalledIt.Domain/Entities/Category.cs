namespace CalledIt.Domain.Entities;

/// <summary>A question category (Sports, Finance, Pop Culture in the MVP).</summary>
public class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Stable code, e.g. "sports" (see <see cref="Categories"/>).</summary>
    public string Code { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;
}
