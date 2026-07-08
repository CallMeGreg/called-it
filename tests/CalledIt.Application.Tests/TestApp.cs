using CalledIt.Application;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Questions;
using CalledIt.Application.Scoring;
using CalledIt.Application.Social;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using CalledIt.Infrastructure;
using CalledIt.Infrastructure.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace CalledIt.Application.Tests;

/// <summary>
/// Boots the real Application + Infrastructure composition root against a throwaway on-disk SQLite
/// database, so tests exercise the same wiring (EF Core, the SQLite DateTimeOffset converter, the
/// in-memory leaderboard store, the stub resolver) that production uses — only the external adapters
/// differ. Each instance gets an isolated database file and is disposed at the end of the test.
/// </summary>
public sealed class TestApp : IDisposable
{
    private readonly string _dbPath;
    public IServiceProvider Services { get; }

    public TestApp()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"calledit-tests-{Guid.NewGuid():N}.db");

        var settings = new Dictionary<string, string?>
        {
            ["Auth:SigningKey"] = "unit-tests-signing-key-0123456789-abcdefghij",
            ["Database:Provider"] = "Sqlite",
            ["ConnectionStrings:Database"] = $"Data Source={_dbPath}",
            ["SocialAuth:UseFake"] = "true",
            ["Contacts:Pepper"] = "unit-tests-pepper",
            ["Game:AdminBootstrapPhones:0"] = "+15555550100",
        };

        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddApplication(config);
        services.AddInfrastructure(config);
        Services = services.BuildServiceProvider();

        using var scope = Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<DbInitializer>()
            .InitializeAsync().GetAwaiter().GetResult();
    }

    private async Task<T> ScopedAsync<T>(Func<IServiceProvider, Task<T>> work)
    {
        using var scope = Services.CreateScope();
        return await work(scope.ServiceProvider);
    }

    private async Task ScopedAsync(Func<IServiceProvider, Task> work)
    {
        using var scope = Services.CreateScope();
        await work(scope.ServiceProvider);
    }

    public Task<Guid> AddUserAsync(
        string phone, string name = "Player", bool discoverable = false, DateTimeOffset? createdAt = null)
        => ScopedAsync(async sp =>
        {
            var db = sp.GetRequiredService<IAppDbContext>();
            var hasher = sp.GetRequiredService<IPhoneHasher>();
            var user = new User
            {
                PhoneE164 = phone,
                PhoneHash = hasher.Hash(phone),
                DisplayName = name,
                DiscoverableByPhone = discoverable,
                CreatedAt = createdAt ?? DateTimeOffset.UtcNow.AddYears(-1),
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user.Id;
        });

    public string Hash(string phone)
    {
        using var scope = Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<IPhoneHasher>().Hash(phone);
    }

    /// <summary>Creates one approved, auto-resolvable question per category then builds the set.</summary>
    public Task<DailySetView> BuildSetWithQuestionsAsync(
        DateTimeOffset drop, DateTimeOffset resolvesAt, string rule = "outcome=a")
        => ScopedAsync(async sp =>
        {
            var questions = sp.GetRequiredService<QuestionService>();
            foreach (var cat in Categories.All)
            {
                await questions.CreateAsync(new CreateQuestionCommand(
                    cat, $"Will {cat} thing happen? {Guid.NewGuid():N}", "Yes", "No", "stub", rule, resolvesAt));
            }

            return await sp.GetRequiredService<DailySetService>().BuildAsync(drop);
        });

    public Task SubmitAsync(Guid userId, Guid questionId, Side? pick, bool skip = false)
        => ScopedAsync(sp => sp.GetRequiredService<GuessService>()
            .SubmitAsync(userId, new SubmitGuessCommand(questionId, pick, skip)));

    public Task<int> ResolveDueAsync()
        => ScopedAsync(sp => sp.GetRequiredService<ResolutionService>().ResolveDueAsync());

    public Task SetOutcomeAsync(Guid adminId, Guid questionId, Outcome outcome, string reason = "test amend")
        => ScopedAsync(sp => sp.GetRequiredService<ResolutionService>()
            .SetOutcomeAsync(adminId, questionId, outcome, reason));

    public Task<IReadOnlyList<ContactMatch>> MatchContactsAsync(Guid callerId, IEnumerable<string> hashes)
        => ScopedAsync(sp => sp.GetRequiredService<ContactsService>().MatchAsync(callerId, hashes));

    /// <summary>Reads the user's score off a global board (null if they are not present).</summary>
    public Task<double?> ScoreAsync(Guid userId, BoardType type, string? category = null)
        => ScopedAsync(async sp =>
        {
            var result = await sp.GetRequiredService<LeaderboardService>()
                .GetAsync(type, BoardScope.Global, userId, category, count: 100);
            var row = result.Rows.FirstOrDefault(r => r.UserId == userId);
            return (double?)(row?.Score);
        });

    public void Dispose()
    {
        (Services as IDisposable)?.Dispose();
        try { File.Delete(_dbPath); } catch { /* best effort */ }
        try { File.Delete(_dbPath + "-shm"); } catch { }
        try { File.Delete(_dbPath + "-wal"); } catch { }
    }
}
