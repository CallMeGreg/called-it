using CalledIt.Application.Abstractions;
using Microsoft.Extensions.Logging;

namespace CalledIt.Infrastructure.Messaging;

/// <summary>Dev SMS sender: logs the OTP instead of sending it. Never use in production.</summary>
public sealed class DevSmsSender : ISmsSender
{
    private readonly ILogger<DevSmsSender> _logger;

    public DevSmsSender(ILogger<DevSmsSender> logger) => _logger = logger;

    public Task SendOtpAsync(string phoneE164, string code, CancellationToken ct = default)
    {
        _logger.LogWarning("[DEV SMS] OTP for {Phone} is {Code}", phoneE164, code);
        return Task.CompletedTask;
    }
}
