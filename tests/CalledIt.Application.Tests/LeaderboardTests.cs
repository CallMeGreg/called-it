using System.Data.Common;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Application.Scoring;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using CalledIt.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace CalledIt.Application.Tests;

public sealed class LeaderboardTests
{
    private static readonly Guid Me = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid Friend = Guid.Parse("00000000-0000-0000-0000-000000000002");
    private static readonly Guid Outsider = Guid.Parse("00000000-0000-0000-0000-000000000003");
    private static readonly Guid Pending = Guid.Parse("00000000-0000-0000-0000-000000000004");
    private static readonly Guid Incoming = Guid.Parse("00000000-0000-0000-0000-000000000005");

    [Theory]
    [InlineData(BoardType.TotalScore, null, 15)]
    [InlineData(BoardType.OverallStreak, null, 5)]
    [InlineData(BoardType.CategoryStreak, Categories.Sports, 3)]
    [InlineData(BoardType.CategoryBestStreak, Categories.Sports, 7)]
    [InlineData(BoardType.CategoryStreak, Categories.Finance, 2)]
    public async Task Boards_read_persisted_projection_values_in_one_bounded_database_query(
        BoardType type, string? category, double expected)
    {
        var recorder = new QueryRecorder();
        using var app = new TestApp(null,
            services => services.ConfigureDbContext<AppDbContext>(options => options.AddInterceptors(recorder)));
        await SeedAsync(app);
        recorder.Commands.Clear();

        var board = await ReadAsync(app.Services, type, BoardScope.Global, category);

        Assert.Equal(expected, board.Rows.Single(r => r.UserId == Me).Score);
        Assert.True(board.Rows.Single(r => r.UserId == Me).IsMe);
        Assert.All(board.Rows.Where(r => r.UserId != Me), row => Assert.False(row.IsMe));
        Assert.Equal(type, board.Type);
        Assert.Equal(category, board.CategoryCode);
        Assert.Equal(Enumerable.Range(1, 5).Select(i => (long)i), board.Rows.Select(r => r.Rank));
        var sql = Assert.Single(recorder.Commands);
        Assert.Contains("ORDER BY", sql);
        Assert.Contains("LIMIT", sql);
        if (category is not null)
        {
            Assert.Contains("WHERE", sql);
            Assert.Contains("CategoryCode", sql);
        }
        else
        {
            Assert.Contains("GROUP BY", sql);
        }
    }

    [Theory]
    [InlineData(BoardType.TotalScore, null)]
    [InlineData(BoardType.OverallStreak, null)]
    [InlineData(BoardType.CategoryStreak, Categories.Sports)]
    public async Task Friends_query_filters_both_directions_and_excludes_pending_before_top(
        BoardType type, string? category)
    {
        var recorder = new QueryRecorder();
        using var app = new TestApp(null,
            services => services.ConfigureDbContext<AppDbContext>(options => options.AddInterceptors(recorder)));
        await SeedAsync(app);
        recorder.Commands.Clear();

        var board = await ReadAsync(app.Services, type, BoardScope.Friends, category, count: 2);

        Assert.Equal(new[] { Me, Friend }, board.Rows.Select(r => r.UserId));
        Assert.Equal(new long[] { 1, 2 }, board.Rows.Select(r => r.Rank));
        var sql = Assert.Single(recorder.Commands);
        Assert.Contains("EXISTS", sql);
        Assert.Contains("Friendships", sql);
        Assert.Contains("LIMIT", sql);

        var all = await ReadAsync(app.Services, type, BoardScope.Friends, category);
        Assert.Equal(new[] { Me, Friend, Incoming }, all.Rows.Select(r => r.UserId));
        Assert.DoesNotContain(all.Rows, row => row.UserId == Outsider || row.UserId == Pending);
    }

    [Fact]
    public async Task Restarted_and_independent_hosts_read_the_same_standings_and_deterministic_ties()
    {
        using var app = new TestApp();
        await SeedAsync(app);
        var before = await ReadAsync(app.Services, BoardType.TotalScore, BoardScope.Global);
        Assert.Equal(new[] { Outsider, Pending, Me, Friend, Incoming }, before.Rows.Select(r => r.UserId));
        ((IDisposable)app.Services).Dispose();

        using var firstHost = app.CreateServices();
        using var secondHost = app.CreateServices();
        var first = await ReadAsync(firstHost, BoardType.TotalScore, BoardScope.Global);
        var second = await ReadAsync(secondHost, BoardType.TotalScore, BoardScope.Global);
        Assert.Equal(before.Rows, first.Rows);
        Assert.Equal(first.Rows, second.Rows);

        using (var scope = firstHost.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IAppDbContext>();
            var score = await db.Scores.SingleAsync(s => s.UserId == Friend && s.CategoryCode == Categories.Sports);
            score.TotalCorrect = 1000;
            await db.SaveChangesAsync();
        }
        var updated = await ReadAsync(secondHost, BoardType.TotalScore, BoardScope.Global, count: 1);
        var leader = Assert.Single(updated.Rows);
        Assert.Equal(Friend, leader.UserId);
        Assert.Equal(1005, leader.Score);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(100)]
    public async Task Count_endpoints_are_supported_and_queries_never_exceed_count(int count)
    {
        using var app = new TestApp();
        await SeedAsync(app);
        var result = await ReadAsync(app.Services, BoardType.TotalScore, BoardScope.Global, count: count);
        Assert.Equal(Math.Min(count, 5), result.Rows.Count);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(101)]
    [InlineData(int.MaxValue)]
    public async Task Unsafe_counts_are_rejected_in_the_service(int count)
    {
        using var app = new TestApp();
        await Assert.ThrowsAsync<ValidationException>(() =>
            ReadAsync(app.Services, BoardType.TotalScore, BoardScope.Global, count: count));
    }

    [Theory]
    [InlineData((BoardType)99, BoardScope.Global, null)]
    [InlineData(BoardType.TotalScore, (BoardScope)99, null)]
    [InlineData(BoardType.CategoryStreak, BoardScope.Global, null)]
    [InlineData(BoardType.CategoryBestStreak, BoardScope.Global, "")]
    [InlineData(BoardType.CategoryStreak, BoardScope.Global, "unknown")]
    [InlineData(BoardType.CategoryBestStreak, BoardScope.Global, "SPORTS")]
    [InlineData(BoardType.TotalScore, BoardScope.Global, Categories.Sports)]
    [InlineData(BoardType.OverallStreak, BoardScope.Global, "unknown")]
    public async Task Invalid_board_scope_and_category_are_rejected(BoardType type, BoardScope scope, string? category)
    {
        using var app = new TestApp();
        await Assert.ThrowsAsync<ValidationException>(() => ReadAsync(app.Services, type, scope, category));
    }

    private static async Task<LeaderboardResult> ReadAsync(
        IServiceProvider services, BoardType type, BoardScope scope, string? category = null, int count = 100)
    {
        using var serviceScope = services.CreateScope();
        return await serviceScope.ServiceProvider.GetRequiredService<LeaderboardService>()
            .GetAsync(type, scope, Me, category, count);
    }

    private static Task SeedAsync(TestApp app) => app.ScopedAsync(async services =>
    {
        var db = services.GetRequiredService<IAppDbContext>();
        var fixtures = new[]
        {
            (Me, 3, 2, 7, 10, 5),
            (Friend, 3, 2, 7, 10, 5),
            (Outsider, 9, 9, 9, 99, 99),
            (Pending, 8, 8, 8, 70, 70),
            (Incoming, 1, 1, 1, 1, 2),
        };
        foreach (var (id, sports, finance, best, sportsTotal, financeTotal) in fixtures)
        {
            var phone = $"+1555{id.ToString("N")[^7..]}";
            db.Users.Add(new User
            {
                Id = id,
                PhoneE164 = phone,
                PhoneHash = services.GetRequiredService<IPhoneHasher>().Hash(phone),
                DisplayName = id == Me ? "Me" : "Player",
            });
            db.Streaks.AddRange(
                new Streak { UserId = id, CategoryCode = Categories.Sports, Current = sports, Best = best },
                new Streak { UserId = id, CategoryCode = Categories.Finance, Current = finance, Best = finance });
            db.Scores.AddRange(
                new Score { UserId = id, CategoryCode = Categories.Sports, TotalCorrect = sportsTotal },
                new Score { UserId = id, CategoryCode = Categories.Finance, TotalCorrect = financeTotal });
        }
        db.Users.Add(new User { PhoneE164 = "+15550000006", PhoneHash = "unranked", DisplayName = "No projection" });
        db.Friendships.AddRange(
            new Friendship { RequesterId = Me, AddresseeId = Friend, Status = FriendshipStatus.Accepted },
            new Friendship { RequesterId = Incoming, AddresseeId = Me, Status = FriendshipStatus.Accepted },
            new Friendship { RequesterId = Me, AddresseeId = Pending, Status = FriendshipStatus.Pending });
        await db.SaveChangesAsync();
    });

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
