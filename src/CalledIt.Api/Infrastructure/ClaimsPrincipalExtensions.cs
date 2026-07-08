using System.Security.Claims;
using CalledIt.Application.Common;

namespace CalledIt.Api.Infrastructure;

/// <summary>Reads the authenticated user's id from the <c>sub</c> claim.</summary>
public static class ClaimsPrincipalExtensions
{
    public static Guid UserId(this ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue("sub")
                  ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);

        if (Guid.TryParse(sub, out var id))
        {
            return id;
        }

        throw new ForbiddenException("The access token is missing a valid subject.");
    }
}
