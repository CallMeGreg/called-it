namespace CalledIt.Domain.Entities;

/// <summary>A named group ("league") players can join to compete on a shared leaderboard.</summary>
public class League
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }

    /// <summary>Short human-shareable code used to join the league.</summary>
    public string JoinCode { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public ICollection<LeagueMembership> Members { get; set; } = new List<LeagueMembership>();
}

public class LeagueMembership
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid LeagueId { get; set; }
    public League? League { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset JoinedAt { get; set; } = DateTimeOffset.UtcNow;
}
