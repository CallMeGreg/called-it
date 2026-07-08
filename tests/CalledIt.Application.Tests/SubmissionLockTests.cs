using CalledIt.Application.Common;
using CalledIt.Domain;

namespace CalledIt.Application.Tests;

/// <summary>
/// The 6-hour hard lock is server-authoritative: once a set's window closes, no pick or skip may be
/// recorded or changed. These tests prove the Application layer enforces that boundary.
/// </summary>
public sealed class SubmissionLockTests
{
    [Fact]
    public async Task Submitting_before_lock_is_accepted()
    {
        using var app = new TestApp();
        var user = await app.AddUserAsync("+15551110001");

        // Dropped a minute ago → window is open for another ~6 hours.
        var set = await app.BuildSetWithQuestionsAsync(
            drop: DateTimeOffset.UtcNow.AddMinutes(-1),
            resolvesAt: DateTimeOffset.UtcNow.AddHours(1));

        Assert.True(set.IsOpen);
        var sports = set.Questions.First(q => q.CategoryCode == Categories.Sports);

        // Should not throw.
        await app.SubmitAsync(user, sports.QuestionId, Side.A);
    }

    [Fact]
    public async Task Submitting_after_lock_throws_SubmissionLocked()
    {
        using var app = new TestApp();
        var user = await app.AddUserAsync("+15551110002");

        // Dropped 7 hours ago → the 6-hour window has already closed.
        var set = await app.BuildSetWithQuestionsAsync(
            drop: DateTimeOffset.UtcNow.AddHours(-7),
            resolvesAt: DateTimeOffset.UtcNow.AddHours(1));

        Assert.False(set.IsOpen);
        var sports = set.Questions.First(q => q.CategoryCode == Categories.Sports);

        await Assert.ThrowsAsync<SubmissionLockedException>(
            () => app.SubmitAsync(user, sports.QuestionId, Side.A));
    }
}
