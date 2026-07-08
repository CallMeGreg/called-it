namespace CalledIt.Application.Abstractions;

/// <summary>Sends SMS one-time passcodes (Azure Communication Services in production).</summary>
public interface ISmsSender
{
    Task SendOtpAsync(string phoneE164, string code, CancellationToken ct = default);
}
