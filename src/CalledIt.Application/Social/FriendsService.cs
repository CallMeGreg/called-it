using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Social;

/// <summary>Friend requests and the accepted friend graph used by friends leaderboards.</summary>
public sealed class FriendsService
{
    private readonly IAppDbContext _db;
    private readonly IClock _clock;

    public FriendsService(IAppDbContext db, IClock clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<FriendView> SendRequestAsync(Guid fromUserId, Guid toUserId, CancellationToken ct = default)
    {
        if (fromUserId == toUserId)
        {
            throw new ValidationException("You cannot add yourself.");
        }

        var target = await _db.Users.FirstOrDefaultAsync(u => u.Id == toUserId, ct)
            ?? throw new NotFoundException("User not found.");

        var existing = await _db.Friendships.FirstOrDefaultAsync(f =>
            (f.RequesterId == fromUserId && f.AddresseeId == toUserId) ||
            (f.RequesterId == toUserId && f.AddresseeId == fromUserId), ct);

        if (existing is not null)
        {
            // If they already requested me, accept it now (mutual).
            if (existing.Status == FriendshipStatus.Pending && existing.AddresseeId == fromUserId)
            {
                existing.Status = FriendshipStatus.Accepted;
                existing.AcceptedAt = _clock.UtcNow;
                await _db.SaveChangesAsync(ct);
                return new FriendView(toUserId, target.DisplayName, existing.Status.ToString());
            }

            return new FriendView(toUserId, target.DisplayName, existing.Status.ToString());
        }

        _db.Friendships.Add(new Friendship
        {
            RequesterId = fromUserId,
            AddresseeId = toUserId,
            Status = FriendshipStatus.Pending,
            CreatedAt = _clock.UtcNow,
        });
        await _db.SaveChangesAsync(ct);

        return new FriendView(toUserId, target.DisplayName, FriendshipStatus.Pending.ToString());
    }

    public async Task AcceptAsync(Guid userId, Guid requesterId, CancellationToken ct = default)
    {
        var request = await _db.Friendships.FirstOrDefaultAsync(f =>
            f.RequesterId == requesterId && f.AddresseeId == userId && f.Status == FriendshipStatus.Pending, ct)
            ?? throw new NotFoundException("No pending request from that user.");

        request.Status = FriendshipStatus.Accepted;
        request.AcceptedAt = _clock.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<FriendView>> ListFriendsAsync(Guid userId, CancellationToken ct = default)
    {
        var friendships = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Accepted && (f.RequesterId == userId || f.AddresseeId == userId))
            .ToListAsync(ct);

        var otherIds = friendships
            .Select(f => f.RequesterId == userId ? f.AddresseeId : f.RequesterId)
            .Distinct()
            .ToList();

        var users = await _db.Users.Where(u => otherIds.Contains(u.Id)).ToListAsync(ct);
        return users.Select(u => new FriendView(u.Id, u.DisplayName, FriendshipStatus.Accepted.ToString())).ToList();
    }

    public async Task<IReadOnlyList<FriendView>> ListPendingAsync(Guid userId, CancellationToken ct = default)
    {
        var pending = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Pending && f.AddresseeId == userId)
            .ToListAsync(ct);

        var requesterIds = pending.Select(f => f.RequesterId).ToList();
        var users = await _db.Users.Where(u => requesterIds.Contains(u.Id)).ToListAsync(ct);
        return users.Select(u => new FriendView(u.Id, u.DisplayName, FriendshipStatus.Pending.ToString())).ToList();
    }
}
