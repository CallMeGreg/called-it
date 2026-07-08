using System.Security.Cryptography;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Social;

/// <summary>Leagues: named groups players join via a short code to share a leaderboard.</summary>
public sealed class LeagueService
{
    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private readonly IAppDbContext _db;
    private readonly IClock _clock;

    public LeagueService(IAppDbContext db, IClock clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<LeagueView> CreateAsync(Guid ownerId, string name, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ValidationException("League name is required.");
        }

        var league = new League
        {
            Name = name.Trim(),
            OwnerId = ownerId,
            JoinCode = await GenerateUniqueCodeAsync(ct),
            CreatedAt = _clock.UtcNow,
        };
        league.Members.Add(new LeagueMembership { LeagueId = league.Id, UserId = ownerId, JoinedAt = _clock.UtcNow });

        _db.Leagues.Add(league);
        await _db.SaveChangesAsync(ct);

        return new LeagueView(league.Id, league.Name, league.JoinCode, 1);
    }

    public async Task<LeagueView> JoinAsync(Guid userId, string joinCode, CancellationToken ct = default)
    {
        var code = (joinCode ?? string.Empty).Trim().ToUpperInvariant();
        var league = await _db.Leagues.FirstOrDefaultAsync(l => l.JoinCode == code, ct)
            ?? throw new NotFoundException("No league with that code.");

        var already = await _db.LeagueMemberships.AnyAsync(m => m.LeagueId == league.Id && m.UserId == userId, ct);
        if (!already)
        {
            _db.LeagueMemberships.Add(new LeagueMembership { LeagueId = league.Id, UserId = userId, JoinedAt = _clock.UtcNow });
            await _db.SaveChangesAsync(ct);
        }

        var count = await _db.LeagueMemberships.CountAsync(m => m.LeagueId == league.Id, ct);
        return new LeagueView(league.Id, league.Name, league.JoinCode, count);
    }

    public async Task<IReadOnlyList<LeagueMemberView>> ListMembersAsync(Guid leagueId, CancellationToken ct = default)
    {
        var memberIds = await _db.LeagueMemberships.Where(m => m.LeagueId == leagueId).Select(m => m.UserId).ToListAsync(ct);
        var users = await _db.Users.Where(u => memberIds.Contains(u.Id)).ToListAsync(ct);
        return users.Select(u => new LeagueMemberView(u.Id, u.DisplayName)).ToList();
    }

    public async Task<IReadOnlyList<LeagueView>> ListMyLeaguesAsync(Guid userId, CancellationToken ct = default)
    {
        var leagueIds = await _db.LeagueMemberships.Where(m => m.UserId == userId).Select(m => m.LeagueId).ToListAsync(ct);
        var leagues = await _db.Leagues.Where(l => leagueIds.Contains(l.Id)).ToListAsync(ct);

        var result = new List<LeagueView>();
        foreach (var l in leagues)
        {
            var count = await _db.LeagueMemberships.CountAsync(m => m.LeagueId == l.Id, ct);
            result.Add(new LeagueView(l.Id, l.Name, l.JoinCode, count));
        }

        return result;
    }

    private async Task<string> GenerateUniqueCodeAsync(CancellationToken ct)
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var code = new string(Enumerable.Range(0, 6)
                .Select(_ => CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)]).ToArray());

            if (!await _db.Leagues.AnyAsync(l => l.JoinCode == code, ct))
            {
                return code;
            }
        }

        throw new ConflictException("Could not allocate a unique league code; try again.");
    }
}
