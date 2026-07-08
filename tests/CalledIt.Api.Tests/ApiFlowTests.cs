using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using CalledIt.Domain;

namespace CalledIt.Api.Tests;

/// <summary>
/// Black-box HTTP tests that drive the API exactly as a mobile client would: phone-OTP login,
/// admin question authoring, the synchronized daily drop, submitting picks, auto-resolution, and
/// reading the leaderboard — asserting the score that comes out the other end.
/// </summary>
public sealed class ApiFlowTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task Health_endpoint_is_anonymous_and_ok()
    {
        using var factory = new CalledItWebAppFactory();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("ok", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Game_endpoints_require_authentication()
    {
        using var factory = new CalledItWebAppFactory();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/today");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Full_flow_from_login_to_leaderboard_scores_correctly()
    {
        using var factory = new CalledItWebAppFactory();
        var client = factory.CreateClient();
        const string adminPhone = "+15555550100"; // configured as an admin bootstrap phone

        // 1) Request an OTP and complete phone + social login as the bootstrapped admin.
        var otpResponse = await client.PostAsJsonAsync("/api/auth/otp", new { PhoneE164 = adminPhone });
        Assert.Equal(HttpStatusCode.Accepted, otpResponse.StatusCode);

        var code = factory.Sms.CodeFor(adminPhone);
        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new
        {
            PhoneE164 = adminPhone,
            Code = code,
            Provider = "Google",
            IdToken = "admin-subject|admin@example.com",
            DisplayName = "Commissioner",
            Platform = "iOS",
        });
        loginResponse.EnsureSuccessStatusCode();

        using (var login = JsonDocument.Parse(await loginResponse.Content.ReadAsStringAsync()))
        {
            Assert.True(login.RootElement.GetProperty("isAdmin").GetBoolean());
            var token = login.RootElement.GetProperty("accessToken").GetString();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        // 2) As admin, author one auto-resolvable question per category (all resolve to side A).
        var resolvesAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        foreach (var category in Categories.All)
        {
            var create = await client.PostAsJsonAsync("/api/admin/questions", new
            {
                CategoryCode = category,
                Text = $"Will the {category} thing happen?",
                SideALabel = "Yes",
                SideBLabel = "No",
                ResolutionSourceKey = "stub",
                ResolutionRule = "outcome=a",
                ResolvesAt = resolvesAt,
            });
            create.EnsureSuccessStatusCode();
        }

        // 3) Build the synchronized set. It drops "now" (just after this admin registered, so they
        //    are eligible for it) and stays open for the 6-hour window.
        var buildResponse = await client.PostAsJsonAsync("/api/admin/daily-sets", new
        {
            DropAtUtc = DateTimeOffset.UtcNow,
        });
        buildResponse.EnsureSuccessStatusCode();

        // 4) Read "today" and submit a pick of A for every question.
        var todayResponse = await client.GetAsync("/api/today");
        todayResponse.EnsureSuccessStatusCode();
        using (var today = JsonDocument.Parse(await todayResponse.Content.ReadAsStringAsync()))
        {
            Assert.True(today.RootElement.GetProperty("isOpen").GetBoolean());
            foreach (var q in today.RootElement.GetProperty("questions").EnumerateArray())
            {
                var questionId = q.GetProperty("questionId").GetGuid();
                var submit = await client.PostAsJsonAsync("/api/guesses", new
                {
                    QuestionId = questionId,
                    Pick = "A",
                    Skip = false,
                });
                submit.EnsureSuccessStatusCode();
            }
        }

        // 5) Auto-resolve all three due questions.
        var resolveResponse = await client.PostAsync("/api/admin/resolve-due", content: null);
        resolveResponse.EnsureSuccessStatusCode();
        using (var resolved = JsonDocument.Parse(await resolveResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal(3, resolved.RootElement.GetProperty("resolved").GetInt32());
        }

        // 6) The global Total Score board should now credit 3 correct picks to me.
        var boardResponse = await client.GetAsync("/api/leaderboards?type=TotalScore&scope=Global");
        boardResponse.EnsureSuccessStatusCode();
        using var board = JsonDocument.Parse(await boardResponse.Content.ReadAsStringAsync());
        var myRow = board.RootElement.GetProperty("rows").EnumerateArray()
            .Single(r => r.GetProperty("isMe").GetBoolean());
        Assert.Equal(3, myRow.GetProperty("score").GetDouble());
    }
}
