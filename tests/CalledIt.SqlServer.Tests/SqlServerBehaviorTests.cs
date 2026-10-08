using System.Data.Common;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Application.Identity;
using CalledIt.Application.Questions;
using CalledIt.Application.Scoring;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using CalledIt.Infrastructure.Identity;
using CalledIt.Infrastructure.Messaging;
using CalledIt.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CalledIt.SqlServer.Tests;

[Collection(SqlServerCollection.Name)]
[Trait("Category", "SqlServer")]
public sealed class SqlServerBehaviorTests(SqlServerFixture server)
{
    [Theory]
    [InlineData(BoardType.TotalScore, null, 15)]
    [InlineData(BoardType.OverallStreak, null, 5)]
    [InlineData(BoardType.CategoryStreak, Categories.Sports, 3)]
    [InlineData(BoardType.CategoryBestStreak, Categories.Sports, 7)]
    public async Task Standings_translate_to_bounded_sql_and_filter_friends_before_top(
        BoardType type, string? category, int expected)
    {
        await using var database = await server.CreateDatabaseAsync();
        var recorder = new QueryRecorder();
        await using var db = database.CreateContext(recorder);
        await db.Database.MigrateAsync();
        var me = User(1);
        var friend = User(2);
        var outsider = User(3);
        db.Users.AddRange(me, friend, outsider);
        foreach (var (user, sports, finance) in new[] { (me, 3, 2), (friend, 2, 1), (outsider, 50, 50) })
        {
            db.Streaks.AddRange(
                new Streak { UserId = user.Id, CategoryCode = Categories.Sports, Current = sports, Best = sports + 4 },
                new Streak { UserId = user.Id, CategoryCode = Categories.Finance, Current = finance, Best = finance });
            db.Scores.AddRange(
                new Score { UserId = user.Id, CategoryCode = Categories.Sports, TotalCorrect = sports * 4 },
                new Score { UserId = user.Id, CategoryCode = Categories.Finance, TotalCorrect = finance + 1 });
        }
        db.Friendships.Add(new Friendship { RequesterId = friend.Id, AddresseeId = me.Id, Status = FriendshipStatus.Accepted });
        db.Friendships.Add(new Friendship { RequesterId = me.Id, AddresseeId = outsider.Id, Status = FriendshipStatus.Pending });
        await db.SaveChangesAsync();

        var service = new LeaderboardService(db);
        recorder.Commands.Clear();
        var friends = await service.GetAsync(type, BoardScope.Friends, me.Id, category, count: 1);
        var row = Assert.Single(friends.Rows);
        Assert.Equal(me.Id, row.UserId);
        Assert.Equal(expected, row.Score);
        Assert.True(row.IsMe);
        var sql = Assert.Single(recorder.Commands);
        Assert.Contains("TOP(", sql);
        Assert.Contains("EXISTS", sql);
        Assert.Contains("ORDER BY", sql);

        var global = await service.GetAsync(type, BoardScope.Global, me.Id, category, count: 1);
        Assert.Equal(outsider.Id, Assert.Single(global.Rows).UserId);
    }

    [Fact]
    public async Task Native_datetimeoffset_ordering_compares_instants_using_a_frozen_clock()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.Database.MigrateAsync();
        var clock = new FrozenClock(new DateTimeOffset(2026, 10, 8, 12, 0, 0, TimeSpan.Zero));
        var current = new DailySet
        {
            DropAtUtc = clock.UtcNow.AddHours(-1).ToOffset(TimeSpan.FromHours(5.5)),
            LocksAtUtc = clock.UtcNow.AddHours(1),
        };
        db.DailySets.AddRange(current,
            new DailySet { DropAtUtc = clock.UtcNow.AddDays(-1), LocksAtUtc = clock.UtcNow.AddDays(-1).AddHours(2) },
            new DailySet { DropAtUtc = clock.UtcNow.AddHours(1), LocksAtUtc = clock.UtcNow.AddHours(3) });
        await db.SaveChangesAsync();

        var today = await new DailySetService(db, clock, Options.Create(new GameOptions())).GetTodayAsync(null);
        Assert.NotNull(today);
        Assert.Equal(current.Id, today.Id);
        Assert.Equal(current.DropAtUtc, today.DropAtUtc);
    }

    [Fact]
    public async Task Case_distinct_social_subjects_coexist_and_lookups_are_exact_for_case_and_accents()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.Database.MigrateAsync();
        string[] subjects = ["Subject", "subject", "s\u00fabject"];
        foreach (var (subject, index) in subjects.Select((value, index) => (value, index)))
        {
            var user = User(index + 1);
            db.Users.Add(user);
            db.FederatedIdentities.Add(new FederatedIdentity
            {
                UserId = user.Id, Provider = SocialProvider.Google, Subject = subject,
            });
        }
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        foreach (var subject in subjects)
        {
            Assert.Equal(subject, (await db.FederatedIdentities.SingleAsync(i =>
                i.Provider == SocialProvider.Google && i.Subject == subject)).Subject);
        }
    }

    [Fact]
    public async Task Sql_padding_never_bypasses_the_application_identity_ownership_guard()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.Database.MigrateAsync();
        var user = User(1);
        var clock = new FrozenClock(new DateTimeOffset(2026, 10, 8, 12, 0, 0, TimeSpan.Zero));
        db.Users.Add(user);
        db.FederatedIdentities.Add(new FederatedIdentity
        {
            UserId = user.Id, Provider = SocialProvider.Google, Subject = "subject",
        });
        db.OtpChallenges.Add(new OtpChallenge
        {
            PhoneE164 = user.PhoneE164, CodeHash = Hashing.Sha256Hex($"{user.PhoneE164}:123456"),
            CreatedAt = clock.UtcNow, ExpiresAt = clock.UtcNow.AddMinutes(5),
        });
        await db.SaveChangesAsync();
        Assert.True(await db.FederatedIdentities.AnyAsync(i => i.Subject == "subject "));
        var authOptions = Options.Create(new AuthOptions { SigningKey = Guid.NewGuid().ToString("N") });
        var service = new AuthService(db, clock, new DevSmsSender(NullLogger<DevSmsSender>.Instance),
            new SubjectValidator("subject "), new JwtTokenService(authOptions, clock),
            new HmacPhoneHasher(Options.Create(new ContactsOptions { Pepper = Guid.NewGuid().ToString("N") })),
            authOptions, Options.Create(new GameOptions()));

        await Assert.ThrowsAsync<ForbiddenException>(() => service.RegisterOrLoginAsync(
            new RegisterOrLoginCommand(user.PhoneE164, "123456", SocialProvider.Google, "test-token", "Must not rename", null, null)));
        Assert.Equal("Player 1", (await db.Users.AsNoTracking().SingleAsync()).DisplayName);
        Assert.Empty(await db.RefreshTokens.ToListAsync());
    }

    [Fact]
    public async Task Concurrent_inserts_cannot_both_claim_the_same_phone()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using (var owner = database.CreateContext())
        {
            await owner.Database.MigrateAsync();
        }
        await using var first = database.CreateContext();
        await using var second = database.CreateContext();
        first.Users.Add(User(1));
        second.Users.Add(User(1));

        var results = await Task.WhenAll(TryInsertAsync(first), TryInsertAsync(second));

        Assert.Single(results, success => success);
        await using var reader = database.CreateContext();
        Assert.Equal(1, await reader.Users.CountAsync());
    }

    [Fact]
    public async Task Foreign_keys_and_length_constraints_are_enforced_by_sql_server()
    {
        await using var database = await server.CreateDatabaseAsync();
        await using var db = database.CreateContext();
        await db.Database.MigrateAsync();
        db.FederatedIdentities.Add(new FederatedIdentity
        {
            UserId = Guid.NewGuid(), Provider = SocialProvider.Google, Subject = "missing-user",
        });
        var foreignKey = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(547, Assert.IsType<SqlException>(foreignKey.InnerException).Number);
        db.ChangeTracker.Clear();
        var user = User(1);
        user.DisplayName = new string('x', 61);
        db.Users.Add(user);
        var length = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Contains(Assert.IsType<SqlException>(length.InnerException).Number, new[] { 2628, 8152 });
    }

    private static User User(int number) => new()
    {
        PhoneE164 = $"+1555000{number:D4}", PhoneHash = $"hash-{number}", DisplayName = $"Player {number}",
    };

    private static async Task<bool> TryInsertAsync(AppDbContext db)
    {
        try
        {
            await db.SaveChangesAsync();
            return true;
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return false;
        }
    }

    private sealed class FrozenClock(DateTimeOffset now) : IClock
    {
        public DateTimeOffset UtcNow => now;
    }

    private sealed class SubjectValidator(string subject) : ISocialTokenValidator
    {
        public Task<SocialIdentity> ValidateAsync(SocialProvider provider, string idToken, CancellationToken ct = default) =>
            Task.FromResult(new SocialIdentity(provider, subject, null));
    }

    private sealed class QueryRecorder : DbCommandInterceptor
    {
        public List<string> Commands { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }
}
