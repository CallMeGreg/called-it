using System.Net;
using System.Text.Json;

namespace CalledIt.Api.Tests;

public sealed class WebHostingTests
{
    [Fact]
    public async Task Web_export_and_routes_are_served_without_turning_unknown_api_or_health_paths_into_html()
    {
        var root = Path.Combine(Path.GetTempPath(), $"calledit-web-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(root, "index.html"), "<!doctype html><title>Called It TEST</title>");
            await File.WriteAllTextAsync(Path.Combine(root, "app.js"), "console.log('test asset');");
            using var host = new CalledItWebAppFactory(webRoot: root);
            using var client = host.CreateClient();

            foreach (var path in new[] { "/", "/play", "/round/history" })
            {
                var response = await client.GetAsync(path);
                response.EnsureSuccessStatusCode();
                Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
                Assert.Contains("Called It TEST", await response.Content.ReadAsStringAsync());
            }
            var script = await client.GetAsync("/app.js");
            script.EnsureSuccessStatusCode();
            Assert.Contains("test asset", await script.Content.ReadAsStringAsync());
            foreach (var path in new[] { "/api/missing", "/api/test/missing", "/health/missing", "/missing.js" })
            {
                var response = await client.GetAsync(path);
                Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
                Assert.NotEqual("text/html", response.Content.Headers.ContentType?.MediaType);
            }
            Assert.False((await client.PostAsync("/play", null)).IsSuccessStatusCode);
            foreach (var path in new[] { "/health", "/health/ready" })
            {
                var response = await client.GetAsync(path);
                response.EnsureSuccessStatusCode();
                Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
                using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                Assert.Equal("ok", body.RootElement.GetProperty("status").GetString());
            }
        }
        finally
        {
            File.Delete(Path.Combine(root, "index.html"));
            File.Delete(Path.Combine(root, "app.js"));
            Directory.Delete(root);
        }
    }

    [Fact]
    public async Task Missing_web_export_leaves_health_usable_and_root_not_found()
    {
        using var host = new CalledItWebAppFactory();
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/")).StatusCode);
        (await client.GetAsync("/health")).EnsureSuccessStatusCode();
    }
}
