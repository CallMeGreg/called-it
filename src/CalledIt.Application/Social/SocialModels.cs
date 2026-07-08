namespace CalledIt.Application.Social;

public sealed record ContactMatch(Guid UserId, string DisplayName);

public sealed record FriendView(Guid UserId, string DisplayName, string Status);

public sealed record LeagueView(Guid Id, string Name, string JoinCode, int MemberCount);

public sealed record LeagueMemberView(Guid UserId, string DisplayName);
