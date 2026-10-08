using System.Text;
using CalledIt.Application.Common;
using CalledIt.Infrastructure.Identity;
using CalledIt.Infrastructure.Messaging;
using CalledIt.Infrastructure.Push;
using CalledIt.Infrastructure.Resolution;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace CalledIt.Infrastructure;

public static class RuntimeConfiguration
{
    public static void Validate(IConfiguration configuration, IHostEnvironment environment)
    {
        var errors = new List<string>();
        var development = environment.IsDevelopment();

        Require("Auth:Issuer");
        Require("Auth:Audience");
        var auth = configuration.GetSection(AuthOptions.SectionName).Get<AuthOptions>() ?? new();
        if (string.IsNullOrWhiteSpace(auth.SigningKey) || Encoding.UTF8.GetByteCount(auth.SigningKey) < 32)
        {
            errors.Add("Auth:SigningKey must contain at least 32 UTF-8 bytes.");
        }
        else if (auth.SigningKey.All(c => c is '0' or '\0')
                 || (!development && auth.SigningKey.StartsWith("dev-only-", StringComparison.OrdinalIgnoreCase)))
        {
            errors.Add("Auth:SigningKey must not use a known zero or development placeholder key.");
        }

        var database = configuration["Database:Provider"];
        if (!string.Equals(database, "SqlServer", StringComparison.OrdinalIgnoreCase)
            && !(development && string.Equals(database, "Sqlite", StringComparison.OrdinalIgnoreCase)))
        {
            errors.Add("Database:Provider must be SqlServer outside Development; Development also permits Sqlite.");
        }
        Require("ConnectionStrings:Database");
        Require("Contacts:Pepper");
        if (!development && configuration["Contacts:Pepper"] is { } pepper
            && pepper.StartsWith("dev-", StringComparison.OrdinalIgnoreCase))
        {
            errors.Add("Contacts:Pepper must be a server-held secret, not a development placeholder.");
        }

        var social = configuration.GetSection(SocialAuthOptions.SectionName).Get<SocialAuthOptions>() ?? new();
        if (social.UseFake && !development)
        {
            errors.Add("SocialAuth:UseFake is only permitted in Development.");
        }
        if (!social.UseFake || !development)
        {
            Require("SocialAuth:AppleAudience");
            Require("SocialAuth:GoogleAudience");
        }

        var sms = configuration.GetSection(SmsOptions.SectionName).Get<SmsOptions>() ?? new();
        if (!Enum.IsDefined(sms.Provider))
        {
            errors.Add("Sms:Provider must be Disabled, Development, or Acs.");
        }
        if (sms.Provider == SmsProvider.Development && !development)
        {
            errors.Add("Sms:Provider=Development is only permitted in Development.");
        }
        if (sms.Provider == SmsProvider.Acs)
        {
            Require("Acs:ConnectionString");
            Require("Acs:FromNumber");
        }

        var push = configuration.GetSection(PushOptions.SectionName).Get<PushOptions>() ?? new();
        if (!Enum.IsDefined(push.Provider))
        {
            errors.Add("Push:Provider must be Disabled, Development, or NotificationHubs.");
        }
        if (push.Provider == PushProvider.Development && !development)
        {
            errors.Add("Push:Provider=Development is only permitted in Development.");
        }
        if (push.Provider == PushProvider.NotificationHubs)
        {
            Require("NotificationHubs:ConnectionString");
            Require("NotificationHubs:HubName");
        }

        if (!development)
        {
            if (configuration.GetValue<bool>($"{ResolutionOptions.SectionName}:UseStub"))
            {
                errors.Add("Resolution:UseStub is only permitted in Development.");
            }
            foreach (var worker in new[] { "EnableDailySetBuilder", "EnableResolver", "EnableWindowClosing" })
            {
                if (configuration.GetValue<bool>($"Workers:{worker}"))
                {
                    errors.Add($"Workers:{worker} must remain false outside Development until its release gates are met.");
                }
            }
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException("Invalid runtime configuration: " + string.Join(" ", errors));
        }

        void Require(string key)
        {
            if (string.IsNullOrWhiteSpace(configuration[key]))
            {
                errors.Add($"{key} must be configured.");
            }
        }
    }
}
