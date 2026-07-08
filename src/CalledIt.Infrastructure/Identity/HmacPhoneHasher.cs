using System.Security.Cryptography;
using System.Text;
using CalledIt.Application.Abstractions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CalledIt.Infrastructure.Identity;

/// <summary>HMAC-SHA256 phone hashing with a server-held pepper (Key Vault in production).</summary>
public sealed class HmacPhoneHasher : IPhoneHasher
{
    private readonly byte[] _pepper;

    public HmacPhoneHasher(IOptions<ContactsOptions> options, ILogger<HmacPhoneHasher> logger)
    {
        var pepper = options.Value.Pepper;
        if (string.IsNullOrWhiteSpace(pepper))
        {
            // Dev fallback so the app runs locally; never rely on this in production.
            pepper = "dev-only-insecure-pepper-change-me";
            logger.LogWarning("Contacts:Pepper is not configured — using an insecure dev pepper.");
        }

        _pepper = Encoding.UTF8.GetBytes(pepper);
    }

    public string Hash(string phoneE164)
    {
        using var hmac = new HMACSHA256(_pepper);
        var bytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(phoneE164.Trim()));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
