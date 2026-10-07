using Microsoft.Extensions.Hosting;

namespace CalledIt.Infrastructure.Persistence;

public sealed class DatabaseStartup
{
    private readonly IHostEnvironment _environment;
    private readonly DbInitializer _initializer;
    private readonly DatabaseReadiness _readiness;

    public DatabaseStartup(
        IHostEnvironment environment, DbInitializer initializer, DatabaseReadiness readiness)
    {
        _environment = environment;
        _initializer = initializer;
        _readiness = readiness;
    }

    public async Task PrepareAsync(CancellationToken ct = default)
    {
        if (_environment.IsDevelopment())
        {
            await _initializer.InitializeAsync(ct);
        }
        else if (!await _readiness.IsReadyAsync(ct))
        {
            throw new InvalidOperationException(
                "Database schema is not ready. Provision database access and apply migrations and required seed data "
                + "with a separate migrator/bootstrap identity before starting this host. "
                + "Runtime migration and seeding are disabled outside Development.");
        }
    }
}
