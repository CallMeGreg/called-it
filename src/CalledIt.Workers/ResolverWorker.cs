using CalledIt.Application.Questions;
using Microsoft.Extensions.Options;

namespace CalledIt.Workers;

/// <summary>
/// Periodically auto-resolves every due, unresolved question that has a working data provider.
/// Resolution triggers an idempotent streak/score recompute inside the application service, so
/// no deployment is ever needed to publish results.
/// </summary>
public sealed class ResolverWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ResolverWorker> _logger;
    private readonly WorkerOptions _options;

    public ResolverWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<ResolverWorker> logger,
        IOptions<WorkerOptions> options)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _options = options.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(5, _options.ResolverIntervalSeconds));

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var resolution = scope.ServiceProvider.GetRequiredService<ResolutionService>();
                var resolved = await resolution.ResolveDueAsync(stoppingToken);
                if (resolved > 0)
                {
                    _logger.LogInformation("Auto-resolved {Count} question(s).", resolved);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Resolver tick failed.");
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (TaskCanceledException)
            {
                break;
            }
        }
    }
}
