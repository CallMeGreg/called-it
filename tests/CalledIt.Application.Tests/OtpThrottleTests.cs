using CalledIt.Application.Common;

namespace CalledIt.Application.Tests;

/// <summary>
/// OTP sends are the app's highest-value abuse vector (paid SMS → toll fraud / "SMS pumping"), so
/// requests to the same phone are rate-limited by a resend cooldown plus rolling hourly/daily caps.
/// These tests prove the Application layer refuses to send once a limit is hit — no SMS is issued.
/// </summary>
public sealed class OtpThrottleTests
{
    [Fact]
    public async Task Second_request_within_cooldown_is_rejected()
    {
        using var app = new TestApp(new Dictionary<string, string?>
        {
            ["Auth:OtpResendCooldownSeconds"] = "60",
            ["Auth:OtpRequestsPerHour"] = "100",
            ["Auth:OtpRequestsPerDay"] = "100",
        });
        const string phone = "+15551230001";

        await app.RequestOtpAsync(phone);

        await Assert.ThrowsAsync<TooManyRequestsException>(() => app.RequestOtpAsync(phone));

        // Only the first (allowed) request produced a challenge → only one SMS would be sent.
        Assert.Equal(1, await app.OtpChallengeCountAsync(phone));
    }

    [Fact]
    public async Task Requests_beyond_the_hourly_cap_are_rejected()
    {
        using var app = new TestApp(new Dictionary<string, string?>
        {
            ["Auth:OtpResendCooldownSeconds"] = "0",
            ["Auth:OtpRequestsPerHour"] = "3",
            ["Auth:OtpRequestsPerDay"] = "100",
        });
        const string phone = "+15551230002";

        for (var i = 0; i < 3; i++)
        {
            await app.RequestOtpAsync(phone);
        }

        await Assert.ThrowsAsync<TooManyRequestsException>(() => app.RequestOtpAsync(phone));
        Assert.Equal(3, await app.OtpChallengeCountAsync(phone));
    }

    [Fact]
    public async Task Different_phone_numbers_are_limited_independently()
    {
        using var app = new TestApp(new Dictionary<string, string?>
        {
            ["Auth:OtpResendCooldownSeconds"] = "60",
            ["Auth:OtpRequestsPerHour"] = "100",
            ["Auth:OtpRequestsPerDay"] = "100",
        });

        await app.RequestOtpAsync("+15551230003");

        // A different number is unaffected by the first number's cooldown.
        await app.RequestOtpAsync("+15551230004");

        Assert.Equal(1, await app.OtpChallengeCountAsync("+15551230003"));
        Assert.Equal(1, await app.OtpChallengeCountAsync("+15551230004"));
    }
}
