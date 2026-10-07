using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Application.Identity;
using CalledIt.Application.Questions;
using CalledIt.Application.Scoring;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CalledIt.Api.Tests;

public sealed class TestModeApiTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    [Fact]
    public async Task Invites_create_isolated_private_accounts_and_refresh_rotates()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var factory = CreateHost(invites, clock);
        using var alice = factory.CreateClient();
        using var bob = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await alice.GetAsync("/api/test/game")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await alice.PostAsJsonAsync("/api/test/login", new
            {
                inviteCode = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
                displayName = "Player",
            })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PostAsJsonAsync("/api/test/login", new { inviteCode = "short", displayName = "Player" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PostAsJsonAsync("/api/test/login", new { inviteCode = invites.First, displayName = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PostAsJsonAsync("/api/test/login", new { inviteCode = invites.First, displayName = new string('x', 61) })).StatusCode);

        var first = await LoginAsync(alice, invites.First, " Same name ");
        var second = await LoginAsync(bob, invites.Second, "Same name");
        Assert.NotEqual(first.UserId, second.UserId);
        Assert.Equal("Same name", first.DisplayName);
        Assert.False(first.IsAdmin);
        Assert.False(second.IsAdmin);
        Assert.Equal(first.UserId, (await LoginAsync(alice, invites.First, "Updated")).UserId);
        Assert.Equal(second.UserId, (await LoginAsync(bob, invites.Second, "Updated")).UserId);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IAppDbContext>();
            var users = await db.Users.ToListAsync();
            Assert.Equal(2, users.Count);
            Assert.All(users, user =>
            {
                Assert.Null(user.PhoneE164);
                Assert.Null(user.PhoneHash);
                Assert.NotNull(user.TestInviteId);
                Assert.False(user.DiscoverableByPhone);
                Assert.False(user.IsAdmin);
            });
            Assert.Empty(await db.FederatedIdentities.ToListAsync());
        }

        Assert.Equal(HttpStatusCode.Forbidden,
            (await alice.PostAsJsonAsync("/api/auth/otp", new { phoneE164 = "+15555550100" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await alice.PostAsJsonAsync("/api/auth/login", new
            {
                phoneE164 = "+15555550100", code = "000000", provider = "Google",
                idToken = "fake", displayName = "Admin",
            })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await alice.PostAsync("/api/admin/resolve-due", null)).StatusCode);

        var contacts = await alice.PostAsJsonAsync("/api/contacts/match", new { hashedPhones = new[] { "" } });
        contacts.EnsureSuccessStatusCode();
        Assert.Empty(await contacts.Content.ReadFromJsonAsync<JsonElement[]>(Json) ?? []);

        var refreshed = await ReadAsync<AuthResult>(
            await alice.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = first.RefreshToken }));
        Assert.Equal(first.UserId, refreshed.UserId);
        Assert.NotEqual(first.RefreshToken, refreshed.RefreshToken);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await alice.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = first.RefreshToken })).StatusCode);
        alice.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", refreshed.AccessToken);
        (await alice.GetAsync("/api/test/game")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Shared_round_locks_at_exactly_two_minutes_and_resolves_with_private_picks()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var factory = CreateHost(invites, clock);
        using var alice = factory.CreateClient();
        using var bob = factory.CreateClient();
        await LoginAsync(alice, invites.First);
        await LoginAsync(bob, invites.Second);

        var first = await GameAsync(alice);
        var other = await GameAsync(bob);
        Assert.Equal(first.CurrentRound.Id, other.CurrentRound.Id);
        Assert.Equal(TimeSpan.FromSeconds(120), first.CurrentRound.LocksAtUtc - first.CurrentRound.DropAtUtc);
        Assert.Equal(clock.UtcNow, first.ServerTimeUtc);
        Assert.Null(first.PreviousRound);
        Assert.Equal(0, first.Stats.TotalScore);
        Assert.Equal(Categories.All, first.CurrentRound.Questions.Select(q => q.CategoryCode));
        Assert.All(first.CurrentRound.Questions, q =>
        {
            Assert.Contains("TEST SAMPLE - SIMULATED", q.Text);
            Assert.Equal("Unresolved", q.Outcome);
        });

        foreach (var question in first.CurrentRound.Questions)
        {
            (await SubmitAsync(alice, question.QuestionId, Side.A)).EnsureSuccessStatusCode();
        }
        var sports = first.CurrentRound.Questions[0];
        var finance = first.CurrentRound.Questions[1];
        (await SubmitAsync(bob, sports.QuestionId, Side.B)).EnsureSuccessStatusCode();
        (await SubmitAsync(bob, finance.QuestionId, null, skip: true)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await SubmitAsync(bob, sports.QuestionId, Side.A, skip: true)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await SubmitAsync(bob, sports.QuestionId, null)).StatusCode);
        var bobView = await GameAsync(bob);
        Assert.Equal(Side.B, bobView.CurrentRound.Questions[0].MyPick);
        Assert.True(bobView.CurrentRound.Questions[1].MySkip);
        Assert.Null(bobView.CurrentRound.Questions[2].MyPick);

        clock.Set(first.CurrentRound.LocksAtUtc.AddTicks(-1));
        (await SubmitAsync(alice, sports.QuestionId, Side.A)).EnsureSuccessStatusCode();
        var justBefore = await GameAsync(alice);
        Assert.Equal(first.CurrentRound.Id, justBefore.CurrentRound.Id);
        Assert.All(justBefore.CurrentRound.Questions, q => Assert.Equal("Unresolved", q.Outcome));

        clock.Set(first.CurrentRound.LocksAtUtc);
        var locked = await SubmitAsync(alice, sports.QuestionId, Side.B);
        Assert.Equal(HttpStatusCode.Locked, locked.StatusCode);
        Assert.Equal("application/problem+json", locked.Content.Headers.ContentType?.MediaType);
        using (var problem = JsonDocument.Parse(await locked.Content.ReadAsStringAsync()))
        {
            Assert.Equal("Submission window closed", problem.RootElement.GetProperty("title").GetString());
        }

        var next = await GameAsync(alice);
        Assert.NotEqual(first.CurrentRound.Id, next.CurrentRound.Id);
        Assert.Equal(clock.UtcNow, next.CurrentRound.DropAtUtc);
        Assert.NotNull(next.PreviousRound);
        Assert.Equal(first.CurrentRound.Id, next.PreviousRound.Id);
        Assert.False(next.PreviousRound.IsOpen);
        Assert.All(next.CurrentRound.Questions, q => Assert.Equal("Unresolved", q.Outcome));
        Assert.All(next.PreviousRound.Questions, q => Assert.Contains(q.Outcome, new[] { "SideA", "SideB" }));
        Assert.Equal(next.PreviousRound.Questions.Count(q => q.Outcome == "SideA"), next.Stats.TotalScore);
        Assert.Equal(next.Stats.TotalScore, next.Stats.OverallStreak);
        Assert.All(next.PreviousRound.Questions, q => Assert.Equal(Side.A, q.MyPick));
        Assert.Equal(next.Stats, (await GameAsync(alice)).Stats, TestStatsComparer.Instance);

        var bobResults = await GameAsync(bob);
        Assert.Equal(next.CurrentRound.Id, bobResults.CurrentRound.Id);
        Assert.Equal(next.PreviousRound.Questions[0].Outcome == "SideB" ? 1 : 0, bobResults.Stats.TotalScore);
        Assert.Equal(0, bobResults.Stats.Categories[1].TotalCorrect);
        Assert.Equal(0, bobResults.Stats.Categories[2].CurrentStreak);
    }

    [Fact]
    public async Task Mid_round_joiner_is_scored_but_pre_account_rounds_are_not_replayed()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var factory = CreateHost(invites, clock);
        using var alice = factory.CreateClient();
        using var bob = factory.CreateClient();
        await LoginAsync(alice, invites.First);
        var old = await GameAsync(alice);
        clock.Set(old.CurrentRound.LocksAtUtc);
        var current = await GameAsync(alice);
        clock.Set(current.CurrentRound.DropAtUtc.AddSeconds(30));
        var newcomer = await LoginAsync(bob, invites.Second);
        Assert.Equal(current.CurrentRound.Id, (await GameAsync(bob)).CurrentRound.Id);

        foreach (var q in current.CurrentRound.Questions)
        {
            (await SubmitAsync(bob, q.QuestionId, Side.A)).EnsureSuccessStatusCode();
            (await SubmitAsync(alice, q.QuestionId, Side.B)).EnsureSuccessStatusCode();
        }

        clock.Set(current.CurrentRound.LocksAtUtc);
        var results = await GameAsync(bob);
        Assert.NotNull(results.PreviousRound);
        var expected = results.PreviousRound.Questions.Count(q => q.Outcome == "SideA");
        Assert.Equal(expected, results.Stats.TotalScore);
        var incumbent = await GameAsync(alice);
        Assert.Equal(3, incumbent.Stats.TotalScore + results.Stats.TotalScore);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IAppDbContext>();
        var account = await db.Users.SingleAsync(u => u.Id == newcomer.UserId);
        Assert.True(account.CreatedAt > current.CurrentRound.DropAtUtc);
        Assert.Equal(3, await db.Scores.CountAsync(s => s.UserId == newcomer.UserId));
        Assert.Equal(3, await db.Guesses.CountAsync(g => g.UserId == newcomer.UserId));
        Assert.False(await db.Guesses.AnyAsync(g => g.UserId == newcomer.UserId && g.DailySetId == old.CurrentRound.Id));
    }

    [Fact]
    public async Task Skips_preserve_streaks_and_missed_rounds_reset_streaks_not_totals_without_idle_backfill()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var factory = CreateHost(invites, clock);
        using var alice = factory.CreateClient();
        using var bob = factory.CreateClient();
        await LoginAsync(alice, invites.First);
        await LoginAsync(bob, invites.Second);
        var round = await GameAsync(alice);
        foreach (var q in round.CurrentRound.Questions)
        {
            (await SubmitAsync(alice, q.QuestionId, Side.A)).EnsureSuccessStatusCode();
            (await SubmitAsync(bob, q.QuestionId, Side.B)).EnsureSuccessStatusCode();
        }

        clock.Set(round.CurrentRound.LocksAtUtc);
        var aliceAfter = await GameAsync(alice);
        var bobAfter = await GameAsync(bob);
        Assert.Equal(3, aliceAfter.Stats.TotalScore + bobAfter.Stats.TotalScore);
        foreach (var q in aliceAfter.CurrentRound.Questions)
        {
            (await SubmitAsync(alice, q.QuestionId, null, skip: true)).EnsureSuccessStatusCode();
            (await SubmitAsync(bob, q.QuestionId, null, skip: true)).EnsureSuccessStatusCode();
        }
        clock.Set(aliceAfter.CurrentRound.LocksAtUtc);
        var aliceSkipped = await GameAsync(alice);
        var bobSkipped = await GameAsync(bob);
        Assert.Equal(aliceAfter.Stats, aliceSkipped.Stats, TestStatsComparer.Instance);
        Assert.Equal(bobAfter.Stats, bobSkipped.Stats, TestStatsComparer.Instance);

        clock.Set(aliceSkipped.CurrentRound.LocksAtUtc.AddDays(30));
        // Obtain fresh tokens after the idle gap rather than bypassing token expiry.
        await LoginAsync(alice, invites.First);
        await LoginAsync(bob, invites.Second);
        var aliceMissed = await GameAsync(alice);
        var bobMissed = await GameAsync(bob);
        Assert.Equal(aliceSkipped.Stats.TotalScore, aliceMissed.Stats.TotalScore);
        Assert.Equal(bobSkipped.Stats.TotalScore, bobMissed.Stats.TotalScore);
        Assert.Equal(0, aliceMissed.Stats.OverallStreak);
        Assert.Equal(0, bobMissed.Stats.OverallStreak);
        Assert.Equal(clock.UtcNow, aliceMissed.CurrentRound.DropAtUtc);
        Assert.Equal(aliceSkipped.CurrentRound.Id, aliceMissed.PreviousRound?.Id);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IAppDbContext>();
        Assert.Equal(4, await db.DailySets.CountAsync(s => s.IsTest));
        Assert.Equal(9, await db.Questions.CountAsync(q => q.Outcome != Outcome.Unresolved));
    }

    [Fact]
    public async Task Repeated_answered_rounds_replay_correct_wrong_and_best_streaks_without_double_counting()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var host = CreateHost(invites, clock);
        using var alice = host.CreateClient();
        using var bob = host.CreateClient();
        await LoginAsync(alice, invites.First);
        await LoginAsync(bob, invites.Second);
        var clients = new[] { alice, bob };
        var current = new int[2, 3];
        var best = new int[2, 3];
        var totals = new int[2, 3];
        var game = await GameAsync(alice);

        for (var round = 0; round < 5; round++)
        {
            for (var player = 0; player < clients.Length; player++)
            {
                foreach (var question in game.CurrentRound.Questions)
                {
                    (await SubmitAsync(clients[player], question.QuestionId, player == 0 ? Side.A : Side.B))
                        .EnsureSuccessStatusCode();
                }
            }
            clock.Set(game.CurrentRound.LocksAtUtc);
            for (var player = 0; player < clients.Length; player++)
            {
                var results = await GameAsync(clients[player]);
                Assert.NotNull(results.PreviousRound);
                for (var category = 0; category < 3; category++)
                {
                    var correct = results.PreviousRound.Questions[category].Outcome == (player == 0 ? "SideA" : "SideB");
                    current[player, category] = correct ? current[player, category] + 1 : 0;
                    best[player, category] = Math.Max(best[player, category], current[player, category]);
                    totals[player, category] += correct ? 1 : 0;
                    Assert.Equal(current[player, category], results.Stats.Categories[category].CurrentStreak);
                    Assert.Equal(best[player, category], results.Stats.Categories[category].BestStreak);
                    Assert.Equal(totals[player, category], results.Stats.Categories[category].TotalCorrect);
                }
                Assert.Equal(Enumerable.Range(0, 3).Sum(c => totals[player, c]), results.Stats.TotalScore);
                Assert.Equal(results.Stats, (await GameAsync(clients[player])).Stats, TestStatsComparer.Instance);
                game = results;
            }
            Assert.Equal((round + 1) * 3, (await BoardAsync(alice)).Rows.Sum(r => r.Score));
        }
    }

    [Fact]
    public async Task Concurrent_hosts_share_one_identity_round_guess_and_resolution()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var database = new TestDatabase();
        using var firstHost = CreateHost(invites, clock, database.Path);
        using var first = firstHost.CreateClient();
        using var secondHost = CreateHost(invites, clock, database.Path);
        using var second = secondHost.CreateClient();

        var logins = await Task.WhenAll(Enumerable.Range(0, 6)
            .Select(i => LoginAsync(i % 2 == 0 ? first : second, invites.First)));
        Assert.Single(logins.Select(l => l.UserId).Distinct());
        var games = await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(i => GameAsync(i % 2 == 0 ? first : second)));
        Assert.Single(games.Select(g => g.CurrentRound.Id).Distinct());
        var round = games[0].CurrentRound;

        var submissions = await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(i => SubmitAsync(i % 2 == 0 ? first : second, round.Questions[0].QuestionId, Side.A)));
        Assert.All(submissions, s => s.EnsureSuccessStatusCode());

        clock.Set(round.LocksAtUtc);
        var resolved = await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(i => GameAsync(i % 2 == 0 ? first : second)));
        Assert.Single(resolved.Select(g => g.CurrentRound.Id).Distinct());
        Assert.All(resolved, g =>
        {
            Assert.Equal(round.Id, g.PreviousRound?.Id);
            Assert.Equal(resolved[0].Stats.TotalScore, g.Stats.TotalScore);
            Assert.Equal(resolved[0].PreviousRound?.Questions.Select(q => q.Outcome),
                g.PreviousRound?.Questions.Select(q => q.Outcome));
        });

        var refreshes = await Task.WhenAll(
            first.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = logins[0].RefreshToken }),
            second.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = logins[0].RefreshToken }));
        Assert.Single(refreshes, r => r.IsSuccessStatusCode);
        Assert.Single(refreshes, r => r.StatusCode == HttpStatusCode.Forbidden);

        using var scope = firstHost.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IAppDbContext>();
        Assert.Single(await db.Users.ToListAsync());
        Assert.Equal(2, await db.DailySets.CountAsync());
        Assert.Single(await db.Guesses.ToListAsync());
        Assert.Equal(3, await db.Scores.CountAsync());
        Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Action == "test.round.resolved"));
    }

    [Fact]
    public async Task Database_leaderboards_and_round_state_survive_restart_without_migrations_or_cache()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var database = new TestDatabase();
        AuthResult account;
        TestGameView result;
        LeaderboardResult board;
        using (var factory = CreateHost(invites, clock, database.Path))
        using (var alice = factory.CreateClient())
        using (var bob = factory.CreateClient())
        {
            account = await LoginAsync(alice, invites.First);
            await LoginAsync(bob, invites.Second);
            var first = await GameAsync(alice);
            foreach (var q in first.CurrentRound.Questions)
            {
                (await SubmitAsync(alice, q.QuestionId, Side.A)).EnsureSuccessStatusCode();
                (await SubmitAsync(bob, q.QuestionId, Side.B)).EnsureSuccessStatusCode();
            }
            clock.Set(first.CurrentRound.LocksAtUtc);
            result = await GameAsync(alice);
            board = await BoardAsync(alice);
            Assert.Equal(3, board.Rows.Sum(r => r.Score));
            Assert.Equal(result.Stats.TotalScore, board.Rows.Single(r => r.IsMe).Score);
        }

        using var restarted = CreateHost(invites, clock, database.Path,
            new Dictionary<string, string?> { ["Database__ApplyMigrationsOnStartup"] = "false" });
        using var client = restarted.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", account.AccessToken);
        var after = await GameAsync(client);
        Assert.Equal(result.CurrentRound.Id, after.CurrentRound.Id);
        Assert.Equal(result.PreviousRound?.Id, after.PreviousRound?.Id);
        Assert.Equal(result.PreviousRound?.Questions, after.PreviousRound?.Questions);
        Assert.Equal(result.Stats, after.Stats, TestStatsComparer.Instance);
        Assert.Equal(board.Rows, (await BoardAsync(client)).Rows);
        var login = await LoginAsync(client, invites.First);
        Assert.Equal(account.UserId, login.UserId);
        (await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = account.RefreshToken })).EnsureSuccessStatusCode();

        foreach (var type in new[] { "CategoryStreak", "CategoryBestStreak", "OverallStreak", "TotalScore" })
        {
            var query = $"/api/leaderboards?type={type}&scope=Global&category=sports";
            var categoryBoard = await ReadAsync<LeaderboardResult>(await client.GetAsync(query));
            Assert.Equal(2, categoryBoard.Rows.Count);
        }

        var friends = await ReadAsync<LeaderboardResult>(
            await client.GetAsync("/api/leaderboards?type=TotalScore&scope=Friends"));
        Assert.Single(friends.Rows);
        Assert.True(friends.Rows[0].IsMe);
        Assert.Equal(1, friends.Rows[0].Rank);
    }

    [Fact]
    public async Task Test_endpoints_are_disabled_by_default_and_unsafe_enabled_settings_fail_closed()
    {
        using (var ordinary = new CalledItWebAppFactory())
        using (var client = ordinary.CreateClient())
        {
            Assert.Equal(HttpStatusCode.NotFound,
                (await client.PostAsJsonAsync("/api/test/login", new
                {
                    inviteCode = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), displayName = "Player",
                })).StatusCode);
        }

        var invites = new TestInvites();
        foreach (var environment in new[] { "Production", "Staging", "test", "Testing" })
        {
            using var invalid = new CalledItWebAppFactory(invites.Settings(), environment);
            var error = Assert.Throws<InvalidOperationException>(() => invalid.CreateClient());
            Assert.Contains("TestMode may only", error.Message);
        }

        foreach (var settings in new[]
        {
            new Dictionary<string, string?> { ["TestMode__RoundSeconds"] = "119" },
            new Dictionary<string, string?> { ["TestMode__InvitesJson"] = "[]" },
            new Dictionary<string, string?> { ["TestMode__InvitesJson"] = "{not-json" },
            new Dictionary<string, string?> { ["TestMode__InvitesJson"] = "[{\"id\":\"tester-1\",\"codeHash\":\"abc\"}]" },
            new Dictionary<string, string?> { ["Auth__SigningKey"] = "" },
            new Dictionary<string, string?> { ["Auth__RefreshTokenDays"] = "0" },
        })
        {
            using var invalid = CreateHost(invites, new TestClock(), settings: settings);
            Assert.Throws<InvalidOperationException>(() => invalid.CreateClient());
        }
    }

    [Fact]
    public async Task Invite_removal_revokes_existing_sessions_and_test_tokens_cannot_cross_modes()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var database = new TestDatabase();
        AuthResult testAccount;
        using (var host = CreateHost(invites, clock, database.Path))
        using (var client = host.CreateClient())
        {
            testAccount = await LoginAsync(client, invites.First);
        }

        using (var removed = CreateHost(invites, clock, database.Path,
            new Dictionary<string, string?> { ["TestMode__InvitesJson"] = invites.SecondOnlyJson() }))
        using (var client = removed.CreateClient())
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", testAccount.AccessToken);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/test/game")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = testAccount.RefreshToken })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync("/api/test/login", new { inviteCode = invites.First, displayName = "Player" })).StatusCode);
        }

        AuthResult ordinaryAccount;
        using (var normal = new CalledItWebAppFactory(databasePath: database.Path, clock: clock))
        using (var client = normal.CreateClient())
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", testAccount.AccessToken);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/today")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = testAccount.RefreshToken })).StatusCode);

            const string phone = "+15555550100";
            (await client.PostAsJsonAsync("/api/auth/otp", new { phoneE164 = phone })).EnsureSuccessStatusCode();
            ordinaryAccount = await ReadAsync<AuthResult>(await client.PostAsJsonAsync("/api/auth/login", new
            {
                phoneE164 = phone, code = normal.Sms.CodeFor(phone), provider = "Google",
                idToken = "production-subject", displayName = "Player",
            }));
            Assert.True(ordinaryAccount.IsAdmin);
        }

        using var testAgain = CreateHost(invites, clock, database.Path);
        using var tester = testAgain.CreateClient();
        tester.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ordinaryAccount.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await tester.GetAsync("/api/test/game")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await tester.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = ordinaryAccount.RefreshToken })).StatusCode);
        var sameName = await LoginAsync(tester, invites.First, ordinaryAccount.DisplayName);
        Assert.Equal(testAccount.UserId, sameName.UserId);
        Assert.NotEqual(ordinaryAccount.UserId, sameName.UserId);
        Assert.False(sameName.IsAdmin);
        var board = await BoardAsync(tester);
        Assert.DoesNotContain(board.Rows, r => r.UserId == ordinaryAccount.UserId);
    }

    [Fact]
    public async Task Invite_login_is_throttled_with_a_clear_problem_response()
    {
        var invites = new TestInvites();
        using var host = CreateHost(invites, new TestClock());
        using var client = host.CreateClient();
        var invalid = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        for (var i = 0; i < 20; i++)
        {
            Assert.Equal(HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync("/api/test/login", new { inviteCode = invalid, displayName = "Player" })).StatusCode);
        }
        var rejected = await client.PostAsJsonAsync("/api/test/login", new { inviteCode = invites.First, displayName = "Player" });
        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.Equal("application/problem+json", rejected.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Enabled_development_mode_allows_invites_without_fake_social_auth()
    {
        var invites = new TestInvites();
        using var host = new CalledItWebAppFactory(invites.Settings(), "Development");
        using var client = host.CreateClient();
        Assert.False((await LoginAsync(client, invites.First)).IsAdmin);
        var response = await client.GetAsync("/api/test/game");
        response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task Ordinary_daily_sets_and_late_registration_rules_remain_separate_from_test_rounds()
    {
        var invites = new TestInvites();
        var clock = new TestClock();
        using var database = new TestDatabase();
        TestGameView testGame;
        Guid testUser;
        using (var host = CreateHost(invites, clock, database.Path))
        using (var client = host.CreateClient())
        {
            testUser = (await LoginAsync(client, invites.First)).UserId;
            testGame = await GameAsync(client);
        }

        DailySetView ordinarySet;
        using (var host = new CalledItWebAppFactory(databasePath: database.Path, clock: clock))
        using (var client = host.CreateClient())
        {
            const string phone = "+15555550100";
            (await client.PostAsJsonAsync("/api/auth/otp", new { phoneE164 = phone })).EnsureSuccessStatusCode();
            var account = await ReadAsync<AuthResult>(await client.PostAsJsonAsync("/api/auth/login", new
            {
                phoneE164 = phone, code = host.Sms.CodeFor(phone), provider = "Google",
                idToken = "ordinary-admin", displayName = "Admin",
            }));
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", account.AccessToken);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/today")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,
                (await SubmitAsync(client, testGame.CurrentRound.Questions[0].QuestionId, Side.A)).StatusCode);

            foreach (var category in Categories.All)
            {
                (await client.PostAsJsonAsync("/api/admin/questions", new
                {
                    categoryCode = category, text = "Ordinary prediction", sideALabel = "Yes", sideBLabel = "No",
                    resolutionSourceKey = "stub", resolutionRule = "outcome=a", resolvesAt = clock.UtcNow,
                })).EnsureSuccessStatusCode();
            }
            ordinarySet = await ReadAsync<DailySetView>(
                await client.PostAsJsonAsync("/api/admin/daily-sets", new { dropAtUtc = clock.UtcNow.AddMinutes(-1) }));
            Assert.Equal(TimeSpan.FromHours(6), ordinarySet.LocksAtUtc - ordinarySet.DropAtUtc);
            foreach (var question in ordinarySet.Questions)
            {
                (await SubmitAsync(client, question.QuestionId, Side.A)).EnsureSuccessStatusCode();
            }
            (await client.PostAsync("/api/admin/resolve-due", null)).EnsureSuccessStatusCode();
            Assert.Equal(ordinarySet.Id, (await ReadAsync<DailySetView>(await client.GetAsync("/api/today"))).Id);
            using var scope = host.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IAppDbContext>();
            Assert.False(await db.Scores.AnyAsync(s => s.UserId == account.UserId || s.UserId == testUser));
        }

        using var testHost = CreateHost(invites, clock, database.Path);
        using var tester = testHost.CreateClient();
        await LoginAsync(tester, invites.First);
        Assert.Equal(HttpStatusCode.NotFound,
            (await SubmitAsync(tester, ordinarySet.Questions[0].QuestionId, Side.A)).StatusCode);
        var isolated = await GameAsync(tester);
        Assert.Equal(testGame.CurrentRound.Id, isolated.CurrentRound.Id);
        Assert.Equal(0, isolated.Stats.TotalScore);
        Assert.All(isolated.CurrentRound.Questions, q => Assert.Equal("Unresolved", q.Outcome));
    }

    [Fact]
    public async Task Database_constraints_enforce_private_invite_identity_and_one_published_test_round()
    {
        var invites = new TestInvites();
        using var host = CreateHost(invites, new TestClock());
        using var client = host.CreateClient();
        var account = await LoginAsync(client, invites.First);
        await GameAsync(client);
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CalledIt.Infrastructure.Persistence.AppDbContext>();
        await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(() =>
            db.Database.ExecuteSqlInterpolatedAsync($"UPDATE Users SET IsAdmin = 1 WHERE Id = {account.UserId}"));
        await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(() =>
            db.Database.ExecuteSqlInterpolatedAsync($"UPDATE Users SET PhoneE164 = '+15555550100' WHERE Id = {account.UserId}"));
        await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(() =>
            db.Database.ExecuteSqlInterpolatedAsync($"UPDATE Users SET DiscoverableByPhone = 1 WHERE Id = {account.UserId}"));

        db.DailySets.Add(new DailySet
        {
            IsTest = true, Status = DailySetStatus.Published,
            DropAtUtc = DateTimeOffset.UtcNow, LocksAtUtc = DateTimeOffset.UtcNow.AddSeconds(120),
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    private static CalledItWebAppFactory CreateHost(
        TestInvites invites, TestClock clock, string? databasePath = null, IDictionary<string, string?>? settings = null)
    {
        var values = invites.Settings();
        if (settings is not null)
        {
            foreach (var (key, value) in settings)
            {
                values[key] = value;
            }
        }
        return new CalledItWebAppFactory(values, "Test", databasePath, clock);
    }

    private static async Task<AuthResult> LoginAsync(HttpClient client, string inviteCode, string displayName = "Player")
    {
        var result = await ReadAsync<AuthResult>(
            await client.PostAsJsonAsync("/api/test/login", new { inviteCode, displayName }));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", result.AccessToken);
        return result;
    }

    private static async Task<TestGameView> GameAsync(HttpClient client) =>
        await ReadAsync<TestGameView>(await client.GetAsync("/api/test/game"));

    private static async Task<LeaderboardResult> BoardAsync(HttpClient client) =>
        await ReadAsync<LeaderboardResult>(await client.GetAsync("/api/leaderboards?type=TotalScore&scope=Global"));

    private static Task<HttpResponseMessage> SubmitAsync(HttpClient client, Guid questionId, Side? pick, bool skip = false) =>
        client.PostAsJsonAsync("/api/guesses", new { questionId, pick, skip }, Json);

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode,
            $"HTTP {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>(Json))!;
    }

    private sealed class TestClock : IClock
    {
        private long _ticks = DateTimeOffset.UtcNow.UtcTicks;
        public DateTimeOffset UtcNow => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);
        public void Set(DateTimeOffset time) => Interlocked.Exchange(ref _ticks, time.UtcTicks);
    }

    private sealed class TestInvites
    {
        public string First { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        public string Second { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

        public Dictionary<string, string?> Settings() => new()
        {
            ["TestMode__Enabled"] = "true",
            ["TestMode__InvitesJson"] = JsonSerializer.Serialize(new[]
            {
                new { id = "tester-1", codeHash = Hashing.Sha256Hex(First) },
                new { id = "tester-2", codeHash = Hashing.Sha256Hex(Second) },
            }),
            ["Leaderboards__Provider"] = "Database",
            ["SocialAuth__UseFake"] = "false",
        };

        public string SecondOnlyJson() => JsonSerializer.Serialize(new[]
        {
            new { id = "tester-2", codeHash = Hashing.Sha256Hex(Second) },
        });
    }

    private sealed class TestDatabase : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"calledit-restart-{Guid.NewGuid():N}.db");
        public void Dispose()
        {
            foreach (var suffix in new[] { "", "-shm", "-wal" })
            {
                File.Delete(Path + suffix);
            }
        }
    }

    private sealed class TestStatsComparer : IEqualityComparer<TestPlayerStats>
    {
        public static TestStatsComparer Instance { get; } = new();
        public bool Equals(TestPlayerStats? x, TestPlayerStats? y) =>
            x?.TotalScore == y?.TotalScore && x?.OverallStreak == y?.OverallStreak
            && x!.Categories.SequenceEqual(y!.Categories);
        public int GetHashCode(TestPlayerStats obj) => HashCode.Combine(obj.TotalScore, obj.OverallStreak);
    }
}
