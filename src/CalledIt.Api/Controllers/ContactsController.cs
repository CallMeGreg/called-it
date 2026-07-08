using CalledIt.Api.Infrastructure;
using CalledIt.Application.Social;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Controllers;

[ApiController]
[Route("api/contacts")]
[Authorize]
public sealed class ContactsController : ControllerBase
{
    private readonly ContactsService _contacts;

    public ContactsController(ContactsService contacts) => _contacts = contacts;

    /// <summary>
    /// Privacy-preserving contact discovery: the client sends peppered E.164 hashes (never raw
    /// numbers) and gets back the registered, discoverable users that match.
    /// </summary>
    [HttpPost("match")]
    public async Task<ActionResult<IReadOnlyList<ContactMatch>>> Match(
        [FromBody] ContactMatchRequest request, CancellationToken ct)
    {
        var matches = await _contacts.MatchAsync(User.UserId(), request.HashedPhones, ct);
        return Ok(matches);
    }
}

public sealed record ContactMatchRequest(IReadOnlyList<string> HashedPhones);
