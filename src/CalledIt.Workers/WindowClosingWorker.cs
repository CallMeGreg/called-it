using CalledIt.Application.Common;
using CalledIt.Application.Notifications;
using Microsoft.Extensions.Options;

namespace CalledIt.Workers;

/// <summary>
/// Sends the "window closing — your streaks are at risk" reminder a configurable number of
/// minutes before each day's hard lock (drop + submission window).
/// </summary>
public sealed class WindowClosingWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<WindowClosingWorker> _logger;
    private readonly WorkerOptions _options;
    private readonly GameOptions _game;

    public WindowClosingWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<WindowClosingWorker> logger,
        IOptions<WorkerOptions> options,
        IOptions<GameOptions> game)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _options = options.Value;
        _game = game.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var remindAt = NextReminder(DateTimeOffset.UtcNow);
            _logger.LogInformation("Next window-closing reminder at {RemindAt:u}", remindAt);

            var delay = remindAt - DateTimeOffset.UtcNow;
            while (delay > TimeSpan.Zero && !stoppingToken.IsCancellationRequested)
            {
                var slice = delay > TimeSpan.FromMinutes(1) ? TimeSpan.FromMinutes(1) : delay;
                await Task.Delay(slice, stoppingToken);
                delay = remindAt - DateTimeOffset.UtcNow;
            }

            if (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
                await notifications.BroadcastWindowClosingAsync(stoppingToken);
                _logger.LogInformation("Sent window-closing reminder.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send the window-closing reminder.");
            }
        }
    }

    private DateTimeOffset NextReminder(DateTimeOffset now)
    {
        // Reminder fires (window - lead) after the drop; walk forward day-by-day if already past.
        var drop = Schedule.NextOccurrence(_options.DropTime, now).AddDays(-1);
        for (var i = 0; i < 3; i++)
        {
            var remind = drop
                .AddHours(_game.SubmissionWindowHours)
                .AddMinutes(-_options.WindowClosingLeadMinutes);

            if (remind > now)
            {
                return remind;
            }

            drop = drop.AddDays(1);
        }

        return drop.AddHours(_game.SubmissionWindowHours).AddMinutes(-_options.WindowClosingLeadMinutes);
    }
}
