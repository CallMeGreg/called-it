using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Infrastructure;
using CalledIt.Infrastructure.Identity;
using CalledIt.Infrastructure.Messaging;
using CalledIt.Infrastructure.Persistence;
using CalledIt.Infrastructure.Push;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CalledIt.Application.Tests;

public sealed class RuntimeConfigurationTests
{
    [Theory]
    [InlineData("Auth:SigningKey", null)]
    [InlineData("Auth:SigningKey", "")]
    [InlineData("Auth:SigningKey", "1234567890123456789012345678901")]
    [InlineData("Auth:SigningKey", "00000000000000000000000000000000")]
    [InlineData("Auth:SigningKey", "dev-only-signing-key-change-me-please-32chars!")]
    [InlineData("Auth:Issuer", " ")]
    [InlineData("Auth:Audience", null)]
    [InlineData("Database:Provider", null)]
    [InlineData("Database:Provider", "SqlSever")]
    [InlineData("Database:Provider", "Sqlite")]
    [InlineData("ConnectionStrings:Database", "")]
    [InlineData("Contacts:Pepper", "")]
    [InlineData("Contacts:Pepper", "dev-pepper-not-for-production")]
    [InlineData("SocialAuth:UseFake", "true")]
    [InlineData("SocialAuth:AppleAudience", "")]
    [InlineData("SocialAuth:GoogleAudience", " ")]
    [InlineData("Sms:Provider", "Development")]
    [InlineData("Sms:Provider", "Misspelled")]
    [InlineData("Sms:Provider", "99")]
    [InlineData("Sms:Provider", "Acs")]
    [InlineData("Push:Provider", "Development")]
    [InlineData("Push:Provider", "Misspelled")]
    [InlineData("Push:Provider", "99")]
    [InlineData("Push:Provider", "NotificationHubs")]
    [InlineData("Resolution:UseStub", "true")]
    [InlineData("Workers:EnableDailySetBuilder", "true")]
    [InlineData("Workers:EnableResolver", "true")]
    [InlineData("Workers:EnableWindowClosing", "true")]
    public void Unsafe_production_settings_fail_before_database_registration(string key, string? value)
    {
        var settings = ProductionSettings();
        settings[key] = value;
        var services = new ServiceCollection();

        Assert.Throws<InvalidOperationException>(() =>
            services.AddInfrastructure(Config(settings), new TestHostEnvironment(Environments.Production)));
        Assert.DoesNotContain(services, service => service.ServiceType == typeof(AppDbContext));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("dev")]
    public void Only_Development_can_use_local_adapters(string environment)
    {
        var settings = ProductionSettings();
        settings["SocialAuth:UseFake"] = "true";

        var error = Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Validate(Config(settings), new TestHostEnvironment(environment)));
        Assert.Contains("SocialAuth:UseFake", error.Message);
    }

    [Fact]
    public void Explicit_Development_configuration_remains_available()
    {
        using var app = new TestApp();
        using var scope = app.Services.CreateScope();
        Assert.IsType<DevSmsSender>(scope.ServiceProvider.GetRequiredService<ISmsSender>());
        Assert.IsType<DevPushSender>(scope.ServiceProvider.GetRequiredService<IPushSender>());
        Assert.IsType<FakeSocialTokenValidator>(scope.ServiceProvider.GetRequiredService<ISocialTokenValidator>());
        Assert.Single(scope.ServiceProvider.GetServices<IResolutionProvider>());
    }

    [Fact]
    public void Misspelled_database_provider_is_rejected_even_in_Development()
    {
        var settings = ProductionSettings();
        settings["Database:Provider"] = "Sqltie";
        Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Validate(Config(settings), new TestHostEnvironment()));
    }

    [Fact]
    public void Signing_key_requirement_counts_UTF8_bytes_not_characters()
    {
        var settings = ProductionSettings();
        settings["Auth:SigningKey"] = new string('\u00e9', 16);
        RuntimeConfiguration.Validate(Config(settings), new TestHostEnvironment(Environments.Production));

        settings["Auth:SigningKey"] = new string('\u00e9', 15);
        Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Validate(Config(settings), new TestHostEnvironment(Environments.Production)));
    }

    [Fact]
    public async Task Missing_provider_selectors_are_disabled_without_any_outbound_dependencies()
    {
        var settings = ProductionSettings();
        // Old credentials must never implicitly enable a provider.
        settings["Acs:ConnectionString"] = "unused-legacy-secret";
        settings["Acs:FromNumber"] = "+15555550000";
        settings["NotificationHubs:ConnectionString"] = "unused-legacy-secret";
        settings["NotificationHubs:HubName"] = "unused-hub";
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddInfrastructure(Config(settings), new TestHostEnvironment(Environments.Production));
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var sms = Assert.IsType<DisabledSmsSender>(scope.ServiceProvider.GetRequiredService<ISmsSender>());
        var push = Assert.IsType<DisabledPushSender>(scope.ServiceProvider.GetRequiredService<IPushSender>());

        Assert.False(sms.IsEnabled);
        await Assert.ThrowsAsync<FeatureUnavailableException>(() => sms.SendOtpAsync("+15555550000", "123456"));
        await Assert.ThrowsAsync<FeatureUnavailableException>(() =>
            push.BroadcastAsync(new PushMessage("Title", "Body")));
        await Assert.ThrowsAsync<FeatureUnavailableException>(() =>
            push.SendToTagAsync("all", new PushMessage("Title", "Body")));
        Assert.Empty(scope.ServiceProvider.GetServices<IResolutionProvider>());
        Assert.IsType<OidcSocialTokenValidator>(scope.ServiceProvider.GetRequiredService<ISocialTokenValidator>());
    }

    [Theory]
    [InlineData("Acs:ConnectionString")]
    [InlineData("Acs:FromNumber")]
    [InlineData("NotificationHubs:ConnectionString")]
    [InlineData("NotificationHubs:HubName")]
    public void Explicit_legacy_adapters_require_each_credential(string missingKey)
    {
        var settings = ProductionSettings();
        settings["Sms:Provider"] = "Acs";
        settings["Push:Provider"] = "NotificationHubs";
        settings["Acs:ConnectionString"] = "configured-by-operator";
        settings["Acs:FromNumber"] = "+15555550000";
        settings["NotificationHubs:ConnectionString"] = "configured-by-operator";
        settings["NotificationHubs:HubName"] = "configured-by-operator";
        RuntimeConfiguration.Validate(Config(settings), new TestHostEnvironment(Environments.Production));

        settings.Remove(missingKey);
        var error = Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Validate(Config(settings), new TestHostEnvironment(Environments.Production)));
        Assert.Contains(missingKey, error.Message);
        Assert.DoesNotContain("configured-by-operator", error.Message);
    }

    private static IConfiguration Config(Dictionary<string, string?> settings) =>
        new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

    private static Dictionary<string, string?> ProductionSettings() => new()
    {
        ["Auth:Issuer"] = "called-it",
        ["Auth:Audience"] = "called-it-clients",
        ["Auth:SigningKey"] = "test-secret-not-used-for-any-deployment-123456789",
        ["Database:Provider"] = "SqlServer",
        ["ConnectionStrings:Database"] = "Server=not-contacted;Database=CalledIt;Authentication=Active Directory Managed Identity;",
        ["Contacts:Pepper"] = "server-held-test-pepper",
        ["SocialAuth:UseFake"] = "false",
        ["SocialAuth:AppleAudience"] = "test.apple.application",
        ["SocialAuth:GoogleAudience"] = "test.google.application",
    };
}
