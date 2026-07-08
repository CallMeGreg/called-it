using CalledIt.Api.Infrastructure;
using CalledIt.Application.Social;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api/friends")]
[Authorize]
public sealed class FriendsController : ControllerBase
{
    private readonly FriendsService _friends;

    public FriendsController(FriendsService friends) => _friends = friends;

    /// <summary>Send a friend request (auto-accepts if the target already requested you).</summary>
    [HttpPost("requests")]
    public async Task<ActionResult<FriendView>> SendRequest([FromBody] FriendRequest request, CancellationToken ct)
    {
        var view = await _friends.SendRequestAsync(User.UserId(), request.ToUserId, ct);
        return Ok(view);
    }

    /// <summary>Accept a pending friend request from the given requester.</summary>
    [HttpPost("{requesterId:guid}/accept")]
    public async Task<IActionResult> Accept(Guid requesterId, CancellationToken ct)
    {
        await _friends.AcceptAsync(User.UserId(), requesterId, ct);
        return NoContent();
    }

    /// <summary>List accepted friends.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<FriendView>>> List(CancellationToken ct) =>
        Ok(await _friends.ListFriendsAsync(User.UserId(), ct));

    /// <summary>List incoming pending friend requests.</summary>
    [HttpGet("pending")]
    public async Task<ActionResult<IReadOnlyList<FriendView>>> Pending(CancellationToken ct) =>
        Ok(await _friends.ListPendingAsync(User.UserId(), ct));
}

public sealed record FriendRequest(Guid ToUserId);
