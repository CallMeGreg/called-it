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

        // --- Leaderboards (Redis when configured, otherwise in-memory) ---
        var redisConn = configuration.GetConnectionString("Redis");
        if (!string.IsNullOrWhiteSpace(redisConn))
        {
            services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConn));
            services.AddScoped<ILeaderboardStore, RedisLeaderboardStore>();
        }
        else
        {
            services.AddSingleton<ILeaderboardStore, InMemoryLeaderboardStore>();
        }

        // --- Resolution providers ---
        services.AddSingleton<IResolutionProvider, StubResolutionProvider>();
        services.AddSingleton<IResolutionProviderRegistry, ResolutionProviderRegistry>();

        return services;
    }
}
