using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;

namespace CalledIt.Infrastructure.Messaging;

public sealed class DisabledSmsSender : ISmsSender
{
    public bool IsEnabled => false;

    public Task SendOtpAsync(string phoneE164, string code, CancellationToken ct = default) =>
        throw new FeatureUnavailableException("Phone verification is currently unavailable.");
}
