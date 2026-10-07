using System.Security.Cryptography;
using System.Text;
using CalledIt.Application.Abstractions;
using Microsoft.Extensions.Options;

namespace CalledIt.Infrastructure.Identity;

/// <summary>HMAC-SHA256 phone hashing with a server-held pepper (Key Vault in production).</summary>
public sealed class HmacPhoneHasher : IPhoneHasher
{
    private readonly byte[] _pepper;

    public HmacPhoneHasher(IOptions<ContactsOptions> options)
    {
        var pepper = options.Value.Pepper;
        if (string.IsNullOrWhiteSpace(pepper))
        {
            throw new InvalidOperationException("Contacts:Pepper must be configured as a server-held secret.");
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
