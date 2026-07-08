using CalledIt.Application.Abstractions;
using CalledIt.Application.Notifications;
using CalledIt.Application.Questions;
using CalledIt.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CalledIt.Workers;

/// <summary>
/// Builds and publishes the one synchronized global daily set at the configured UTC drop time,
/// then fires the "today's drop" broadcast. Idempotent: it never builds two sets for the same drop.
/// </summary>
public sealed class DailySetBuilderWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DailySetBuilderWorker> _logger;
    private readonly WorkerOptions _options;

    public DailySetBuilderWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<DailySetBuilderWorker> logger,
        IOptions<WorkerOptions> options)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _options = options.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var dropAt = Schedule.NextOccurrence(_options.DropTime, DateTimeOffset.UtcNow);
            _logger.LogInformation("Next daily set drops at {DropAt:u}", dropAt);

            await DelayUntil(dropAt, stoppingToken);
            if (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            await BuildAsync(dropAt, stoppingToken);
        }
    }

    private async Task BuildAsync(DateTimeOffset dropAt, CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IAppDbContext>();

            if (await db.DailySets.AnyAsync(s => s.DropAtUtc == dropAt, ct))
            {
                _logger.LogInformation("A set already exists for {DropAt:u}; skipping.", dropAt);
                return;
            }

            var sets = scope.ServiceProvider.GetRequiredService<DailySetService>();
            var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();

            var view = await sets.BuildAsync(dropAt, ct);
            _logger.LogInformation("Published daily set {SetId} with {Count} questions.", view.Id, view.Questions.Count);

            await notifications.BroadcastDropAsync(view.Id, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to build the daily set for {DropAt:u}.", dropAt);
        }
    }

    private static async Task DelayUntil(DateTimeOffset instant, CancellationToken ct)
    {
        var delay = instant - DateTimeOffset.UtcNow;
        while (delay > TimeSpan.Zero && !ct.IsCancellationRequested)
        {
            // Cap individual waits so config/clock changes are picked up within a minute.
            var slice = delay > TimeSpan.FromMinutes(1) ? TimeSpan.FromMinutes(1) : delay;
            await Task.Delay(slice, ct);
            delay = instant - DateTimeOffset.UtcNow;
        }
    }
}
