using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using CalledIt.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace CalledIt.Api.Tests;

public sealed class FoundationApiTests
{
    [Theory]
    [InlineData("/health")]
    [InlineData("/health/live")]
    [InlineData("/health/ready")]
    public async Task Health_routes_are_anonymous_and_not_cached(string path)
    {
        using var factory = new CalledItWebAppFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ok", body.RootElement.GetProperty("status").GetString());
        Assert.True(body.RootElement.GetProperty("utc").TryGetDateTimeOffset(out _));
    }

    [Fact]
    public async Task Readiness_failure_is_generic_and_does_not_change_liveness_and_recovers()
    {
        using var factory = new CalledItWebAppFactory();
        using var client = factory.CreateClient();
        factory.DatabaseFaults.Unavailable = true;

        var ready = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
        Assert.Equal("application/problem+json", ready.Content.Headers.ContentType?.MediaType);
        var body = await ready.Content.ReadAsStringAsync();
        Assert.Contains("The database is not ready.", body);
        Assert.DoesNotContain("sensitive-connection-details", body);
        Assert.DoesNotContain("Sqlite", body);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);

        factory.DatabaseFaults.Unavailable = false;
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
    }

    [Theory]
    [InlineData("Scores", "ALTER TABLE Scores RENAME TO Scores_unavailable",
        "ALTER TABLE Scores_unavailable RENAME TO Scores")]
    [InlineData("Guesses", "ALTER TABLE Guesses RENAME TO Guesses_unavailable",
        "ALTER TABLE Guesses_unavailable RENAME TO Guesses")]
    public async Task Reachable_database_with_missing_critical_schema_is_not_ready(
        string table, string removeSchema, string restoreSchema)
    {
        using var factory = new CalledItWebAppFactory();
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync(removeSchema);

        Assert.True(await db.Database.CanConnectAsync());
        var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.DoesNotContain(table, await response.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);

        await db.Database.ExecuteSqlRawAsync(restoreSchema);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
    }

    [Theory]
    [InlineData("/api/auth/otp")]
    [InlineData("/api/auth/login")]
    public async Task Disabled_phone_verification_returns_intentional_503_without_writes(string path)
    {
        using var factory = new CalledItWebAppFactory(recordSms: false);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(path, new
        {
            PhoneE164 = "+15553330001", Code = "123456", Provider = "Google", IdToken = "subject",
        });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Phone verification is currently unavailable.", await response.Content.ReadAsStringAsync());
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Empty(await db.OtpChallenges.ToListAsync());
        Assert.Empty(await db.Users.ToListAsync());
    }

    [Theory]
    [InlineData("count=0")]
    [InlineData("count=101")]
    [InlineData("count=2147483647")]
    [InlineData("scope=99")]
    [InlineData("scope=Unknown")]
    [InlineData("type=99")]
    [InlineData("type=CategoryStreak")]
    [InlineData("type=CategoryStreak&category=unknown")]
    [InlineData("type=TotalScore&category=sports")]
    public async Task Leaderboard_rejects_invalid_query_values_instead_of_clamping(string query)
    {
        using var factory = new CalledItWebAppFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken());

        var response = await client.GetAsync("/api/leaderboards?" + query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("audience")]
    [InlineData("issuer")]
    [InlineData("key")]
    [InlineData("expired")]
    [InlineData("unsigned")]
    [InlineData("expiry")]
    public async Task API_bearer_validation_rejects_invalid_tokens(string flaw)
    {
        using var factory = new CalledItWebAppFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken(flaw));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/leaderboards")).StatusCode);
    }

    private static string AccessToken(string? flaw = null)
    {
        var now = DateTime.UtcNow;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(
            flaw == "key" ? new string('0', 32) : "api-tests-signing-key-0123456789-abcdefghij"));
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: flaw == "issuer" ? "foreign-issuer" : "called-it",
            audience: flaw == "audience" ? "foreign-application" : "called-it-clients",
            claims: [new Claim("sub", Guid.NewGuid().ToString())],
            notBefore: now.AddHours(-1),
            expires: flaw == "expiry" ? null : flaw == "expired" ? now.AddMinutes(-10) : now.AddMinutes(15),
            signingCredentials: flaw == "unsigned" ? null : new SigningCredentials(key, SecurityAlgorithms.HmacSha256)));
    }
}
