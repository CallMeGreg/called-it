using CalledIt.Application.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Social;

/// <summary>
/// Privacy-preserving contact matching. The client hashes each contact's E.164 number with the
/// same server pepper and sends only hashes; we match against registered users' phone hashes and
/// return those who opted in to discoverability.
/// </summary>
public sealed class ContactsService
{
    private readonly IAppDbContext _db;

    public ContactsService(IAppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ContactMatch>> MatchAsync(
        Guid currentUserId, IEnumerable<string> hashedPhones, CancellationToken ct = default)
    {
        var hashes = hashedPhones
            .Where(h => !string.IsNullOrWhiteSpace(h))
            .Select(h => h.Trim().ToLowerInvariant())
            .Distinct()
            .Take(5000)
            .ToList();

        if (hashes.Count == 0)
        {
            return Array.Empty<ContactMatch>();
        }

        var matches = await _db.Users
            .Where(u => u.Id != currentUserId && u.TestInviteId == null
                && u.DiscoverableByPhone && u.PhoneHash != null && hashes.Contains(u.PhoneHash))
            .Select(u => new ContactMatch(u.Id, u.DisplayName))
            .ToListAsync(ct);

        return matches;
    }
}
