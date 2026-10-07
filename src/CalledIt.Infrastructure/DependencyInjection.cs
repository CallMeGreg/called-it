using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Infrastructure.Identity;
using CalledIt.Infrastructure.Leaderboards;
using CalledIt.Infrastructure.Messaging;
using CalledIt.Infrastructure.Persistence;
using CalledIt.Infrastructure.Push;
using CalledIt.Infrastructure.Resolution;
using CalledIt.Infrastructure.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;

namespace CalledIt.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(configuration);
        // --- Options ---
        services.Configure<ContactsOptions>(configuration.GetSection(ContactsOptions.SectionName));
        services.Configure<SocialAuthOptions>(configuration.GetSection(SocialAuthOptions.SectionName));
        services.Configure<AcsOptions>(configuration.GetSection(AcsOptions.SectionName));
        services.Configure<NotificationHubsOptions>(configuration.GetSection(NotificationHubsOptions.SectionName));

        // --- Persistence (SQLite for dev/test, SQL Server for production) ---
        var provider = configuration["Database:Provider"] ?? "Sqlite";
        var connectionString = configuration.GetConnectionString("Database") ?? "Data Source=called-it.db";

        services.AddDbContext<AppDbContext>(options =>
        {
            if (provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase))
            {
                options.UseSqlServer(connectionString);
            }
            else
            {
                options.UseSqlite(connectionString);
            }
        });
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());
        services.AddScoped<DbInitializer>();
        services.AddScoped<ITestModeTransaction, TestModeTransaction>();

        // --- Core services ---
        services.AddSingleton<IClock, SystemClock>();
        services.AddScoped<ITokenService, JwtTokenService>();
        services.AddSingleton<IPhoneHasher, HmacPhoneHasher>();

        // --- Social login validation (fake in dev, real OIDC in production) ---
        var useFakeSocial = configuration.GetValue($"{SocialAuthOptions.SectionName}:UseFake", true);
        if (useFakeSocial)
        {
            services.AddSingleton<ISocialTokenValidator, FakeSocialTokenValidator>();
        }
        else
        {
            services.AddSingleton<ISocialTokenValidator, OidcSocialTokenValidator>();
        }

        // --- SMS (ACS when configured, otherwise dev logger) ---
        var acs = new AcsOptions();
        configuration.GetSection(AcsOptions.SectionName).Bind(acs);
        if (acs.IsConfigured)
        {
            services.AddScoped<ISmsSender, AcsSmsSender>();
        }
        else
        {
            services.AddScoped<ISmsSender, DevSmsSender>();
        }

        // --- Push (Notification Hubs when configured, otherwise dev logger) ---
        var nh = new NotificationHubsOptions();
        configuration.GetSection(NotificationHubsOptions.SectionName).Bind(nh);
        if (nh.IsConfigured)
        {
            services.AddScoped<IPushSender, NotificationHubsPushSender>();
        }
        else
        {
            services.AddScoped<IPushSender, DevPushSender>();
        }

        // --- Leaderboards (explicit provider, with the existing auto-detection as default) ---
        var redisConn = configuration.GetConnectionString("Redis");
        var boardsProvider = configuration["Leaderboards:Provider"]
            ?? (string.IsNullOrWhiteSpace(redisConn) ? "InMemory" : "Redis");
        if (boardsProvider.Equals("Database", StringComparison.OrdinalIgnoreCase))
        {
            services.AddScoped<ILeaderboardReader, DatabaseLeaderboardReader>();
        }
        else if (boardsProvider.Equals("Redis", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(redisConn))
            {
                throw new InvalidOperationException("ConnectionStrings:Redis is required for Leaderboards:Provider=Redis.");
            }

            services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConn));
            services.AddScoped<ILeaderboardStore, RedisLeaderboardStore>();
            services.AddScoped<ILeaderboardReader>(sp => sp.GetRequiredService<ILeaderboardStore>());
        }
        else if (boardsProvider.Equals("InMemory", StringComparison.OrdinalIgnoreCase))
        {
            services.AddSingleton<ILeaderboardStore, InMemoryLeaderboardStore>();
            services.AddSingleton<ILeaderboardReader>(sp => sp.GetRequiredService<ILeaderboardStore>());
        }
        else
        {
            throw new InvalidOperationException("Leaderboards:Provider must be Database, Redis, or InMemory.");
        }

        // --- Resolution providers ---
        services.AddSingleton<IResolutionProvider, StubResolutionProvider>();
        services.AddSingleton<IResolutionProviderRegistry, ResolutionProviderRegistry>();

        return services;
    }
}
