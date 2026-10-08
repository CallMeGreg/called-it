using CalledIt.Application.Abstractions;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace CalledIt.Infrastructure.Persistence;

public sealed class AppDbContext : DbContext, IAppDbContext
{
    private readonly bool _isSqlite;

    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
        _isSqlite = options.Extensions.Any(e => e.GetType().Name.Contains("Sqlite", StringComparison.Ordinal));
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<FederatedIdentity> FederatedIdentities => Set<FederatedIdentity>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<League> Leagues => Set<League>();
    public DbSet<LeagueMembership> LeagueMemberships => Set<LeagueMembership>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<ResolutionSource> ResolutionSources => Set<ResolutionSource>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<DailySet> DailySets => Set<DailySet>();
    public DbSet<DailySetItem> DailySetItems => Set<DailySetItem>();
    public DbSet<Guess> Guesses => Set<Guess>();
    public DbSet<Streak> Streaks => Set<Streak>();
    public DbSet<Score> Scores => Set<Score>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<OtpChallenge> OtpChallenges => Set<OtpChallenge>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // SQLite (dev/test) cannot ORDER BY / compare a native DateTimeOffset. Store the UTC
        // instant as sortable ticks so queries that order by time work. SQL Server keeps the
        // native datetimeoffset column (this converter is not applied there).
        if (_isSqlite)
        {
            configurationBuilder.Properties<DateTimeOffset>().HaveConversion<UtcTicksDateTimeOffsetConverter>();
        }

        base.ConfigureConventions(configurationBuilder);
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.PhoneE164).IsUnique();
            e.HasIndex(x => x.PhoneHash);
            e.Property(x => x.PhoneE164).HasMaxLength(20).IsRequired();
            e.Property(x => x.PhoneHash).HasMaxLength(128).IsRequired();
            e.Property(x => x.DisplayName).HasMaxLength(60).IsRequired();
        });

        b.Entity<FederatedIdentity>(e =>
        {
            e.HasIndex(x => new { x.Provider, x.Subject }).IsUnique();
            e.Property(x => x.Subject).HasMaxLength(256).IsRequired();
            if (!_isSqlite)
            {
                e.Property(x => x.Subject).UseCollation("Latin1_General_100_BIN2");
            }
            e.HasOne(x => x.User).WithMany(u => u.Identities).HasForeignKey(x => x.UserId);
        });

        b.Entity<Device>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.PushToken }).IsUnique();
            e.Property(x => x.PushToken).HasMaxLength(512).IsRequired();
            e.HasOne(x => x.User).WithMany(u => u.Devices).HasForeignKey(x => x.UserId);
        });

        b.Entity<Friendship>(e =>
        {
            e.HasIndex(x => new { x.RequesterId, x.AddresseeId }).IsUnique();
        });

        b.Entity<League>(e =>
        {
            e.HasIndex(x => x.JoinCode).IsUnique();
            e.Property(x => x.Name).HasMaxLength(60).IsRequired();
            e.Property(x => x.JoinCode).HasMaxLength(12).IsRequired();
            e.HasMany(x => x.Members).WithOne(m => m.League!).HasForeignKey(m => m.LeagueId);
        });

        b.Entity<LeagueMembership>(e =>
        {
            e.HasIndex(x => new { x.LeagueId, x.UserId }).IsUnique();
        });

        b.Entity<Category>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Code).HasMaxLength(40).IsRequired();
            e.Property(x => x.DisplayName).HasMaxLength(60).IsRequired();
        });

        b.Entity<ResolutionSource>(e =>
        {
            e.HasIndex(x => x.Key).IsUnique();
            e.Property(x => x.Key).HasMaxLength(80).IsRequired();
        });

        b.Entity<Question>(e =>
        {
            e.Property(x => x.Text).HasMaxLength(500).IsRequired();
            e.Property(x => x.SideALabel).HasMaxLength(60).IsRequired();
            e.Property(x => x.SideBLabel).HasMaxLength(60).IsRequired();
            e.Property(x => x.ResolutionSourceKey).HasMaxLength(80);
            e.Property(x => x.ResolutionRule).HasMaxLength(400);
            e.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId);
            e.HasIndex(x => new { x.Status, x.ResolvesAt });
        });

        b.Entity<DailySet>(e =>
        {
            e.HasIndex(x => x.DropAtUtc);
            e.HasMany(x => x.Items).WithOne(i => i.DailySet!).HasForeignKey(i => i.DailySetId);
        });

        b.Entity<DailySetItem>(e =>
        {
            e.HasIndex(x => new { x.DailySetId, x.CategoryCode }).IsUnique();
            e.HasIndex(x => x.QuestionId);
            e.Property(x => x.CategoryCode).HasMaxLength(40).IsRequired();
            e.HasOne(x => x.Question).WithMany().HasForeignKey(x => x.QuestionId);
        });

        b.Entity<Guess>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.QuestionId }).IsUnique();
            e.HasIndex(x => new { x.DailySetId, x.UserId });
            e.Property(x => x.CategoryCode).HasMaxLength(40).IsRequired();
        });

        b.Entity<Streak>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.CategoryCode }).IsUnique();
            e.Property(x => x.CategoryCode).HasMaxLength(40).IsRequired();
        });

        b.Entity<Score>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.CategoryCode }).IsUnique();
            e.Property(x => x.CategoryCode).HasMaxLength(40).IsRequired();
        });

        b.Entity<OtpChallenge>(e =>
        {
            e.HasIndex(x => new { x.PhoneE164, x.CreatedAt });
            e.Property(x => x.PhoneE164).HasMaxLength(20).IsRequired();
            e.Property(x => x.CodeHash).HasMaxLength(128).IsRequired();
        });

        b.Entity<RefreshToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();
        });

        b.Entity<AuditLog>(e =>
        {
            e.HasIndex(x => new { x.EntityType, x.EntityId });
            e.Property(x => x.Action).HasMaxLength(80).IsRequired();
            e.Property(x => x.EntityType).HasMaxLength(80).IsRequired();
            e.Property(x => x.EntityId).HasMaxLength(80).IsRequired();
        });

        base.OnModelCreating(b);
    }
}

/// <summary>
/// Stores a <see cref="DateTimeOffset"/> as its UTC tick count (a monotonic <see cref="long"/>)
/// so SQLite can order and compare timestamps. All app timestamps are UTC.
/// </summary>
internal sealed class UtcTicksDateTimeOffsetConverter : ValueConverter<DateTimeOffset, long>
{
    public UtcTicksDateTimeOffsetConverter()
        : base(v => v.UtcTicks, v => new DateTimeOffset(v, TimeSpan.Zero))
    {
    }
}
