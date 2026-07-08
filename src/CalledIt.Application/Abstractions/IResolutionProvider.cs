using CalledIt.Domain;
using CalledIt.Domain.Entities;

namespace CalledIt.Application.Abstractions;

/// <summary>
/// Resolves a single question's outcome from an external data source. Implementations are
/// keyed by <see cref="SourceKey"/> (matching <see cref="Question.ResolutionSourceKey"/>).
/// </summary>
public interface IResolutionProvider
{
    string SourceKey { get; }

    Task<Outcome> ResolveAsync(Question question, CancellationToken ct = default);
}

/// <summary>Looks up the right <see cref="IResolutionProvider"/> for a question.</summary>
public interface IResolutionProviderRegistry
{
    bool TryGet(string sourceKey, out IResolutionProvider provider);
}
