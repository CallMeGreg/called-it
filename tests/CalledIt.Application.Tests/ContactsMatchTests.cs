namespace CalledIt.Application.Tests;

/// <summary>
/// Contact matching only ever sees HMAC-peppered phone hashes, and only returns users who opted in
/// to discoverability. Raw phone numbers are never compared.
/// </summary>
public sealed class ContactsMatchTests
{
    [Fact]
    public async Task Match_returns_discoverable_users_and_excludes_others()
    {
        using var app = new TestApp();

        var me = await app.AddUserAsync("+15553330000", name: "Me");
        var friend = await app.AddUserAsync("+15553330001", name: "Discoverable Friend", discoverable: true);
        var hidden = await app.AddUserAsync("+15553330002", name: "Hidden", discoverable: false);

        // The client sends hashes for everyone in the address book — including my own number.
        var hashes = new[]
        {
            app.Hash("+15553330000"), // me — must be excluded from my own matches
            app.Hash("+15553330001"), // discoverable friend — should match
            app.Hash("+15553330002"), // opted out — must not match
            app.Hash("+15559999999"), // not a registered user
        };

        var matches = await app.MatchContactsAsync(me, hashes);

        Assert.Contains(matches, m => m.UserId == friend);
        Assert.DoesNotContain(matches, m => m.UserId == hidden);
        Assert.DoesNotContain(matches, m => m.UserId == me);
        Assert.Single(matches);
    }

    [Fact]
    public async Task Match_with_no_hashes_returns_empty()
    {
        using var app = new TestApp();
        var me = await app.AddUserAsync("+15553331000", name: "Me");

        var matches = await app.MatchContactsAsync(me, Array.Empty<string>());

        Assert.Empty(matches);
    }
}
