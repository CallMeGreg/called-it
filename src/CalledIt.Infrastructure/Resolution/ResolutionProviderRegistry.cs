using CalledIt.Application.Abstractions;

namespace CalledIt.Infrastructure.Resolution;

/// <summary>Resolves providers by their <see cref="IResolutionProvider.SourceKey"/>.</summary>
public sealed class ResolutionProviderRegistry : IResolutionProviderRegistry
{
    private readonly IReadOnlyDictionary<string, IResolutionProvider> _byKey;

    public ResolutionProviderRegistry(IEnumerable<IResolutionProvider> providers)
    {
        _byKey = providers
            .GroupBy(p => p.SourceKey)
            .ToDictionary(g => g.Key, g => g.Last(), StringComparer.OrdinalIgnoreCase);
    }

    public bool TryGet(string sourceKey, out IResolutionProvider provider) =>
        _byKey.TryGetValue(sourceKey ?? string.Empty, out provider!);
}
