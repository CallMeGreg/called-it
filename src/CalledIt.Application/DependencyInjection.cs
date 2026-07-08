using CalledIt.Application.Common;
using CalledIt.Application.Identity;
using CalledIt.Application.Notifications;
using CalledIt.Application.Questions;
using CalledIt.Application.Scoring;
using CalledIt.Application.Social;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace CalledIt.Application;

/// <summary>Registers application services + options. Ports are bound by the Infrastructure layer.</summary>
public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AuthOptions>(configuration.GetSection(AuthOptions.SectionName));
        services.Configure<GameOptions>(configuration.GetSection(GameOptions.SectionName));

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

        return services;
    }
}
