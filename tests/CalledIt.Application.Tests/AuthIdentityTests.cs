using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Application.Identity;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CalledIt.Application.Tests;

public sealed class AuthIdentityTests
{
    [Theory]
    [InlineData(SocialProvider.Apple)]
    [InlineData(SocialProvider.Google)]
    public async Task New_user_binds_verified_phone_and_subject_and_can_log_in_again(SocialProvider provider)
    {
        using var app = new TestApp();
        var created = await SignInAsync(app, "+15551110001", provider, "subject", "First");
        var login = await SignInAsync(app, "+15551110001", provider, "subject", "Updated");

        Assert.Equal(created.UserId, login.UserId);
        Assert.Equal("Updated", login.DisplayName);
        await app.ScopedAsync(async services =>
        {
            var db = services.GetRequiredService<IAppDbContext>();
            var user = Assert.Single(await db.Users.ToListAsync());
            var identity = Assert.Single(await db.FederatedIdentities.ToListAsync());
            Assert.Equal(user.Id, identity.UserId);
            Assert.Equal(provider, identity.Provider);
            Assert.Equal("subject", identity.Subject);
            Assert.Equal("+15551110001", user.PhoneE164);
            Assert.Equal(app.Hash(user.PhoneE164), user.PhoneHash);
            Assert.Equal(2, await db.RefreshTokens.CountAsync());
        });
    }

    [Fact]
    public async Task Same_subject_text_at_different_providers_is_not_the_same_identity()
    {
        using var app = new TestApp();
        var apple = await SignInAsync(app, "+15551110001", SocialProvider.Apple, "same-subject", "Apple");
        var google = await SignInAsync(app, "+15551110002", SocialProvider.Google, "same-subject", "Google");
        Assert.NotEqual(apple.UserId, google.UserId);
    }

    [Theory]
    [InlineData("+15551110001", SocialProvider.Google, "second-subject")]
    [InlineData("+15551110001", SocialProvider.Google, "unowned-subject")]
    [InlineData("+15551110001", SocialProvider.Google, "FIRST-SUBJECT")]
    [InlineData("+15551110001", SocialProvider.Apple, "first-subject")]
    [InlineData("+15551110003", SocialProvider.Google, "first-subject")]
    public async Task Conflicting_or_unlinked_combination_does_not_modify_accounts(
        string phone, SocialProvider provider, string subject)
    {
        using var app = new TestApp();
        await SignInAsync(app, "+15551110001", SocialProvider.Google, "first-subject", "First");
        await SignInAsync(app, "+15551110002", SocialProvider.Google, "second-subject", "Second");
        var before = await SnapshotAsync(app);

        var error = await Assert.ThrowsAsync<ForbiddenException>(() =>
            SignInAsync(app, phone, provider, subject, "Must not change", pushToken: "must-not-register"));

        Assert.Equal("The phone and social identity do not match a linked account.", error.Message);
        Assert.Equal(before, await SnapshotAsync(app));
    }

    [Fact]
    public async Task Existing_phone_without_any_link_cannot_claim_an_unowned_social_identity()
    {
        using var app = new TestApp();
        await app.AddUserAsync("+15551110001", "Unlinked");
        var before = await SnapshotAsync(app);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            SignInAsync(app, "+15551110001", SocialProvider.Google, "new-subject", "Must not change"));

        Assert.Equal(before, await SnapshotAsync(app));
    }

    [Fact]
    public async Task Incorrect_OTP_cannot_create_a_linked_account()
    {
        using var app = new TestApp();
        await Assert.ThrowsAsync<ValidationException>(() =>
            SignInAsync(app, "+15551110001", SocialProvider.Google, "subject", "Player", code: "654321"));
        await app.ScopedAsync(async services =>
        {
            var db = services.GetRequiredService<IAppDbContext>();
            Assert.Empty(await db.Users.ToListAsync());
            Assert.Empty(await db.FederatedIdentities.ToListAsync());
            Assert.Empty(await db.RefreshTokens.ToListAsync());
        });
    }

    [Fact]
    public async Task Disabled_verification_rejects_send_and_login_without_writing_challenges_or_accounts()
    {
        using var app = new TestApp(new Dictionary<string, string?> { ["Sms:Provider"] = "Disabled" });
        var before = await SnapshotAsync(app);
        await Assert.ThrowsAsync<FeatureUnavailableException>(() => app.RequestOtpAsync("+15551110001"));
        await app.ScopedAsync(async services =>
        {
            await Assert.ThrowsAsync<FeatureUnavailableException>(() =>
                services.GetRequiredService<AuthService>().RegisterOrLoginAsync(new RegisterOrLoginCommand(
                    "+15551110001", "123456", SocialProvider.Google, "subject", "Player", null, null)));
            Assert.Empty(await services.GetRequiredService<IAppDbContext>().OtpChallenges.ToListAsync());
        });
        Assert.Equal(before, await SnapshotAsync(app));
    }

    private static Task<AuthResult> SignInAsync(
        TestApp app, string phone, SocialProvider provider, string subject, string displayName,
        string? pushToken = null, string code = "123456") =>
        app.ScopedAsync(async services =>
        {
            var db = services.GetRequiredService<IAppDbContext>();
            db.OtpChallenges.Add(new OtpChallenge
            {
                PhoneE164 = phone,
                CodeHash = Hashing.Sha256Hex($"{phone}:123456"),
                CreatedAt = DateTimeOffset.UtcNow,
                ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
            });
            await db.SaveChangesAsync();
            return await services.GetRequiredService<AuthService>().RegisterOrLoginAsync(new RegisterOrLoginCommand(
                phone, code, provider, subject, displayName, DevicePlatform.iOS, pushToken));
        });

    private static Task<string[]> SnapshotAsync(TestApp app) => app.ScopedAsync(async services =>
    {
        var db = services.GetRequiredService<IAppDbContext>();
        var users = await db.Users.AsNoTracking().OrderBy(u => u.Id).ToListAsync();
        var identities = await db.FederatedIdentities.AsNoTracking().OrderBy(i => i.Id).ToListAsync();
        var refresh = await db.RefreshTokens.AsNoTracking().OrderBy(t => t.Id).ToListAsync();
        var devices = await db.Devices.AsNoTracking().OrderBy(d => d.Id).ToListAsync();
        return users.Select(u => $"user:{u.Id}:{u.PhoneE164}:{u.PhoneHash}:{u.DisplayName}:{u.IsAdmin}")
            .Concat(identities.Select(i => $"identity:{i.Id}:{i.UserId}:{i.Provider}:{i.Subject}"))
            .Concat(refresh.Select(t => $"refresh:{t.Id}:{t.UserId}:{t.TokenHash}:{t.Revoked}"))
            .Concat(devices.Select(d => $"device:{d.Id}:{d.UserId}:{d.PushToken}"))
            .ToArray();
    });
}
