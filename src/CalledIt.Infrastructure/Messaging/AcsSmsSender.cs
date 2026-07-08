using Azure.Communication.Sms;
using CalledIt.Application.Abstractions;
using Microsoft.Extensions.Options;

namespace CalledIt.Infrastructure.Messaging;

/// <summary>Sends OTP SMS via Azure Communication Services.</summary>
public sealed class AcsSmsSender : ISmsSender
{
    private readonly SmsClient _client;
    private readonly AcsOptions _options;

    public AcsSmsSender(IOptions<AcsOptions> options)
    {
        _options = options.Value;
        _client = new SmsClient(_options.ConnectionString);
    }

    public async Task SendOtpAsync(string phoneE164, string code, CancellationToken ct = default)
    {
        await _client.SendAsync(
            from: _options.FromNumber,
            to: phoneE164,
            message: $"Your Called It code is {code}. It expires in a few minutes.",
            cancellationToken: ct);
    }
}
