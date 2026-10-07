using CalledIt.Application.Common;
using CalledIt.Application.Identity;
using CalledIt.Application.Notifications;
using CalledIt.Application.Questions;
using CalledIt.Application.Scoring;
using CalledIt.Application.Social;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace CalledIt.Application;

/// <summary>Registers application services + options. Ports are bound by the Infrastructure layer.</summary>
public static class DependencyInjection
{
    public static IServiceCollection AddApplication(
        this IServiceCollection services, IConfiguration configuration, string environmentName = "Production")
    {
        services.Configure<AuthOptions>(configuration.GetSection(AuthOptions.SectionName));
        services.Configure<GameOptions>(configuration.GetSection(GameOptions.SectionName));

        var testMode = configuration.GetSection(TestModeOptions.SectionName).Get<TestModeOptions>() ?? new TestModeOptions();
        testMode.Validate(environmentName);
        if (testMode.Enabled)
        {
            var auth = configuration.GetSection(AuthOptions.SectionName).Get<AuthOptions>() ?? new AuthOptions();
            if (string.IsNullOrWhiteSpace(auth.SigningKey) || auth.SigningKey.Length < 32
                || auth.AccessTokenMinutes <= 0 || auth.RefreshTokenDays <= 0)
            {
                throw new InvalidOperationException(
                    "TEST mode requires Auth:SigningKey with at least 32 characters and positive token lifetimes.");
            }
        }
        services.AddSingleton<IOptions<TestModeOptions>>(Options.Create(testMode));

        services.AddScoped<AuthService>();
        services.AddScoped<QuestionService>();
        services.AddScoped<DailySetService>();
        services.AddScoped<GuessService>();
        services.AddScoped<ResolutionService>();
        services.AddScoped<RecomputeService>();
        services.AddScoped<LeaderboardService>();
        services.AddScoped<ContactsService>();
        services.AddScoped<FriendsService>();
        services.AddScoped<LeagueService>();
        services.AddScoped<NotificationService>();
        services.AddScoped<TestGameService>();

        return services;
    }
}
