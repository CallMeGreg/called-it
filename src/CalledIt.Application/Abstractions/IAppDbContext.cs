using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Abstractions;

/// <summary>
/// The persistence surface the application uses. Implemented by the EF Core DbContext in
/// Infrastructure; tests provide a SQLite/in-memory implementation.
/// </summary>
public interface IAppDbContext
{
    DbSet<User> Users { get; }
    DbSet<FederatedIdentity> FederatedIdentities { get; }
    DbSet<Device> Devices { get; }
    DbSet<Friendship> Friendships { get; }
    DbSet<League> Leagues { get; }
    DbSet<LeagueMembership> LeagueMemberships { get; }
    DbSet<Category> Categories { get; }
    DbSet<ResolutionSource> ResolutionSources { get; }
    DbSet<Question> Questions { get; }
    DbSet<DailySet> DailySets { get; }
    DbSet<DailySetItem> DailySetItems { get; }
    DbSet<Guess> Guesses { get; }
    DbSet<Streak> Streaks { get; }
    DbSet<Score> Scores { get; }
    DbSet<AuditLog> AuditLogs { get; }
    DbSet<OtpChallenge> OtpChallenges { get; }
    DbSet<RefreshToken> RefreshTokens { get; }

    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
