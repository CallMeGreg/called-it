using System.Text.Json;
using System.Text.Json.Serialization;

namespace CalledIt.Application.Common;

public sealed class TestModeOptions
{
    public const string SectionName = "TestMode";
    public const string InviteClaim = "test_invite";

    public bool Enabled { get; set; }
    public int RoundSeconds { get; set; } = 120;
    public string InvitesJson { get; set; } = "[]";

    public IReadOnlyList<TestInvite> Invites { get; private set; } = Array.Empty<TestInvite>();

    public void Validate(string environmentName)
    {
        if (!Enabled)
        {
            return;
        }

        if (environmentName is not ("Test" or "Development"))
        {
            throw new InvalidOperationException("TestMode may only be enabled in Test or Development.");
        }

        if (RoundSeconds != 120)
        {
            throw new InvalidOperationException("TestMode:RoundSeconds must be 120 for the TEST POC.");
        }

        List<InviteConfiguration>? configured;
        try
        {
            configured = InvitesJson is { Length: <= 100_000 }
                ? JsonSerializer.Deserialize<List<InviteConfiguration>>(InvitesJson,
                    new JsonSerializerOptions(JsonSerializerDefaults.Web)
                    {
                        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
                    })
                : null;
        }
        catch (JsonException)
        {
            // Do not include configuration values or JSON parser excerpts in startup logs.
            throw new InvalidOperationException("TestMode:InvitesJson must be an array of {id,codeHash}.");
        }

        if (configured is null || configured.Count is < 1 or > 100
            || configured.Any(i => i is null
                || string.IsNullOrEmpty(i.Id) || i.Id.Length > 64
                || i.Id.Any(c => !(c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_'))
                || i.CodeHash is null || i.CodeHash.Length != 64
                || i.CodeHash.Any(c => !(c is >= 'a' and <= 'f' or >= '0' and <= '9')))
            || configured.Select(i => i.Id).Distinct(StringComparer.Ordinal).Count() != configured.Count
            || configured.Select(i => i.CodeHash).Distinct(StringComparer.Ordinal).Count() != configured.Count)
        {
            throw new InvalidOperationException(
                "TestMode requires 1-100 unique invite IDs (1-64 lowercase letters, digits, '-' or '_') "
                + "and unique lowercase SHA256 code hashes.");
        }

        Invites = configured.Select(i => new TestInvite(i.Id, Convert.FromHexString(i.CodeHash))).ToArray();
    }

    public void RequireEnabled()
    {
        if (!Enabled)
        {
            throw new NotFoundException("TEST mode is not available.");
        }
    }

    private sealed class InviteConfiguration
    {
        public required string Id { get; init; }
        public required string CodeHash { get; init; }
    }
}

public sealed class TestInvite(string id, byte[] codeHash)
{
    public string Id { get; } = id;
    public ReadOnlyMemory<byte> CodeHash { get; } = codeHash;
}
