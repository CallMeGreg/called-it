using System.Security.Cryptography;
using System.Text;
using CalledIt.Application.Abstractions;
using CalledIt.Domain;
using CalledIt.Domain.Entities;

namespace CalledIt.Infrastructure.Resolution;

/// <summary>
/// A deterministic resolver for local/dev/demos. The outcome can be pinned via the question's
/// resolution rule ("outcome=A", "outcome=B", or "outcome=void"); otherwise it derives a stable
/// pseudo-random result from the question id so demos resolve predictably.
///
/// Production sources (e.g. "sports.scores.v1") are implemented as HTTP-backed providers that
/// call the relevant data API and apply the rule; the stub keeps the pipeline runnable offline.
/// </summary>
public sealed class StubResolutionProvider : IResolutionProvider
{
    public string SourceKey => "stub";

    public Task<Outcome> ResolveAsync(Question question, CancellationToken ct = default)
    {
        var rule = question.ResolutionRule?.ToLowerInvariant() ?? string.Empty;

        if (rule.Contains("outcome=void"))
        {
            return Task.FromResult(Outcome.Void);
        }

        if (rule.Contains("outcome=a"))
        {
            return Task.FromResult(Outcome.SideA);
        }

        if (rule.Contains("outcome=b"))
        {
            return Task.FromResult(Outcome.SideB);
        }

        var hash = MD5.HashData(Encoding.UTF8.GetBytes(question.Id.ToString()));
        return Task.FromResult((hash[0] & 1) == 0 ? Outcome.SideA : Outcome.SideB);
    }
}
