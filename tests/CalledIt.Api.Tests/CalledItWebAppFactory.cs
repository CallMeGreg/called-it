using System.Collections.Concurrent;
using CalledIt.Application.Abstractions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CalledIt.Api.Tests;

/// <summary>Captures OTP codes in-process so integration tests can complete the phone-login flow
/// without a real SMS provider (mirrors what the dev sender logs).</summary>
public sealed class RecordingSmsSender : ISmsSender
{
    private readonly ConcurrentDictionary<string, string> _codes = new();

    public Task SendOtpAsync(string phoneE164, string code, CancellationToken ct = default)
    {
        _codes[phoneE164] = code;
        return Task.CompletedTask;
    }

    public string CodeFor(string phoneE164) =>
        _codes.TryGetValue(phoneE164, out var code)
            ? code
            : throw new InvalidOperationException($"No OTP was recorded for {phoneE164}.");
}

/// <summary>
/// Spins up the real API in-memory (TestServer) against an isolated SQLite file, with the fake
/// social validator and a recording SMS sender so the full authenticated game flow can be driven
/// over HTTP. Everything else is the production wiring.
/// </summary>
/// <remarks>
/// Configuration is supplied via process environment variables rather than
/// <c>ConfigureAppConfiguration</c>: the API reads <c>builder.Configuration</c> at configure-time
/// (for the DB provider and the JWT signing key), which the minimal-hosting model populates from
/// environment variables but not from a test's in-memory source (that is only merged at Build-time).
/// Using env vars keeps the token-issuing and token-validating keys in agreement and gives each
/// factory its own database file.
/// </remarks>
public sealed class CalledItWebAppFactory : WebApplicationFactory<Program>
{
    public RecordingSmsSender Sms { get; } = new();

    private readonly string _dbPath;
    private readonly bool _ownsDatabase;
    private readonly Dictionary<string, string?> _env;
    private readonly IClock? _clock;
    private readonly string? _webRoot;

    public CalledItWebAppFactory(
        IDictionary<string, string?>? settings = null, string environment = "Development",
        string? databasePath = null, IClock? clock = null, string? webRoot = null)
    {
        _dbPath = databasePath ?? Path.Combine(Path.GetTempPath(), $"calledit-api-{Guid.NewGuid():N}.db");
        _ownsDatabase = databasePath is null;
        _clock = clock;
        _webRoot = webRoot;
        var values = new Dictionary<string, string?>
        {
            ["ASPNETCORE_ENVIRONMENT"] = environment,
            ["DOTNET_ENVIRONMENT"] = environment,
            ["Database__Provider"] = "Sqlite",
            ["Database__ApplyMigrationsOnStartup"] = "true",
            ["ConnectionStrings__Database"] = $"Data Source={_dbPath}",
            ["ConnectionStrings__Redis"] = "",
            ["Leaderboards__Provider"] = "InMemory",
            ["Auth__SigningKey"] = "api-tests-signing-key-0123456789-abcdefghij",
            ["SocialAuth__UseFake"] = "true",
            ["Contacts__Pepper"] = "api-tests-pepper",
            ["Game__AdminBootstrapPhones__0"] = "+15555550100",
            ["TestMode__Enabled"] = "false",
            ["TestMode__RoundSeconds"] = "120",
            ["TestMode__InvitesJson"] = "[]",
            ["Logging__LogLevel__Default"] = "Warning",
        };

        if (settings is not null)
        {
            foreach (var (key, value) in settings)
            {
                values[key] = value;
            }
        }

        _env = values.Keys.ToDictionary(k => k, Environment.GetEnvironmentVariable);
        foreach (var (key, value) in values)
        {
            Environment.SetEnvironmentVariable(key, value);
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (_webRoot is not null)
        {
            builder.UseWebRoot(_webRoot);
        }

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<ISmsSender>();
            services.AddSingleton<ISmsSender>(Sms);
            if (_clock is not null)
            {
                services.RemoveAll<IClock>();
                services.AddSingleton(_clock);
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.TokenValidationParameters.LifetimeValidator = (notBefore, expires, _, _) =>
                        (notBefore is null || notBefore <= _clock.UtcNow.UtcDateTime)
                        && expires > _clock.UtcNow.UtcDateTime;
                });
            }
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        foreach (var (key, value) in _env)
        {
            Environment.SetEnvironmentVariable(key, value);
        }

        if (_ownsDatabase)
        {
            foreach (var suffix in new[] { "", "-shm", "-wal" })
            {
                File.Delete(_dbPath + suffix);
            }
        }
    }
}
