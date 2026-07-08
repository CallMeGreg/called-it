using System.Text.Json;
using CalledIt.Application.Common;
using Microsoft.AspNetCore.Mvc;

namespace CalledIt.Api.Infrastructure;

/// <summary>
/// Translates expected <see cref="AppException"/>s into RFC 7807 ProblemDetails with the right
/// HTTP status, and hides unexpected errors behind a generic 500.
/// </summary>
public sealed class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (AppException ex)
        {
            await WriteProblemAsync(context, StatusFor(ex), Title(ex), ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception processing {Path}", context.Request.Path);
            await WriteProblemAsync(context, StatusCodes.Status500InternalServerError,
                "Server error", "An unexpected error occurred.");
        }
    }

    private static int StatusFor(AppException ex) => ex switch
    {
        ValidationException => StatusCodes.Status400BadRequest,
        ForbiddenException => StatusCodes.Status403Forbidden,
        NotFoundException => StatusCodes.Status404NotFound,
        ConflictException => StatusCodes.Status409Conflict,
        SubmissionLockedException => StatusCodes.Status423Locked,
        _ => StatusCodes.Status400BadRequest,
    };

    private static string Title(AppException ex) => ex switch
    {
        ValidationException => "Validation failed",
        ForbiddenException => "Forbidden",
        NotFoundException => "Not found",
        ConflictException => "Conflict",
        SubmissionLockedException => "Submission window closed",
        _ => "Request error",
    };

    private static async Task WriteProblemAsync(HttpContext context, int status, string title, string detail)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        var problem = new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = detail,
        };

        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(problem));
    }
}
