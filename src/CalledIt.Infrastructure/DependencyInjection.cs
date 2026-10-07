using CalledIt.Application.Abstractions;
using CalledIt.Infrastructure.Identity;
using CalledIt.Infrastructure.Messaging;
using CalledIt.Infrastructure.Persistence;
using CalledIt.Infrastructure.Push;
using CalledIt.Infrastructure.Resolution;
using CalledIt.Infrastructure.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CalledIt.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        RuntimeConfiguration.Validate(configuration, environment);

        // --- Options ---
        services.Configure<ContactsOptions>(configuration.GetSection(ContactsOptions.SectionName));
        services.Configure<SocialAuthOptions>(configuration.GetSection(SocialAuthOptions.SectionName));
        services.Configure<AcsOptions>(configuration.GetSection(AcsOptions.SectionName));
        services.Configure<NotificationHubsOptions>(configuration.GetSection(NotificationHubsOptions.SectionName));

        // --- Persistence (SQLite for dev/test, SQL Server for production) ---
        var provider = configuration["Database:Provider"]!;
        var connectionString = configuration.GetConnectionString("Database")!;

        services.AddDbContext<AppDbContext>(options =>
        {
            if (provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase))
            {
                options.UseSqlServer(connectionString);
            }
            else if (provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase))
            {
                options.UseSqlite(connectionString);
            }
            else
            {
                throw new InvalidOperationException("Unsupported Database:Provider.");
            }
        });
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());
        services.AddScoped<DbInitializer>();
        services.AddScoped<DatabaseReadiness>();
        services.AddScoped<DatabaseStartup>();

        // --- Core services ---
        services.AddSingleton<IClock, SystemClock>();
        services.AddScoped<ITokenService, JwtTokenService>();
        services.AddSingleton<IPhoneHasher, HmacPhoneHasher>();

        // --- Social login validation (fake in dev, real OIDC in production) ---
        var useFakeSocial = configuration.GetValue<bool>($"{SocialAuthOptions.SectionName}:UseFake");
        if (useFakeSocial)
        {
            services.AddSingleton<ISocialTokenValidator, FakeSocialTokenValidator>();
        }
        else
        {
            services.AddSingleton<ISocialTokenValidator, OidcSocialTokenValidator>();
        }

        var sms = configuration.GetSection(SmsOptions.SectionName).Get<SmsOptions>() ?? new();
        switch (sms.Provider)
        {
            case SmsProvider.Disabled:
                services.AddScoped<ISmsSender, DisabledSmsSender>();
                break;
            case SmsProvider.Development:
                services.AddScoped<ISmsSender, DevSmsSender>();
                break;
            case SmsProvider.Acs:
                services.AddScoped<ISmsSender, AcsSmsSender>();
                break;
        }

        var push = configuration.GetSection(PushOptions.SectionName).Get<PushOptions>() ?? new();
        switch (push.Provider)
        {
            case PushProvider.Disabled:
                services.AddScoped<IPushSender, DisabledPushSender>();
                break;
            case PushProvider.Development:
                services.AddScoped<IPushSender, DevPushSender>();
                break;
            case PushProvider.NotificationHubs:
                services.AddScoped<IPushSender, NotificationHubsPushSender>();
                break;
        }

        // --- Resolution providers ---
        if (configuration.GetValue<bool>($"{ResolutionOptions.SectionName}:UseStub"))
        {
            services.AddSingleton<IResolutionProvider, StubResolutionProvider>();
        }
        services.AddSingleton<IResolutionProviderRegistry, ResolutionProviderRegistry>();

        return services;
    }
}
