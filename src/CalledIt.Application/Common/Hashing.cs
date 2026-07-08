using System.Security.Cryptography;
using System.Text;

namespace CalledIt.Application.Common;

public static class Hashing
{
    public static string Sha256Hex(string input)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
