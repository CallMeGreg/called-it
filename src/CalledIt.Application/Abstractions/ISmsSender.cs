namespace CalledIt.Application.Abstractions;

/// <summary>Legacy app-generated OTP transport; a managed verification supplier is not yet selected.</summary>
public interface ISmsSender
{
    bool IsEnabled { get; }

    Task SendOtpAsync(string phoneE164, string code, CancellationToken ct = default);
}
