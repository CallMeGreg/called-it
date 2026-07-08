namespace CalledIt.Application.Common;

/// <summary>Base class for expected application errors mapped to HTTP status codes at the edge.</summary>
public abstract class AppException : Exception
{
    protected AppException(string message) : base(message) { }
}

public sealed class NotFoundException : AppException
{
    public NotFoundException(string message) : base(message) { }
}

public sealed class ForbiddenException : AppException
{
    public ForbiddenException(string message) : base(message) { }
}

public sealed class ValidationException : AppException
{
    public ValidationException(string message) : base(message) { }
}

public sealed class ConflictException : AppException
{
    public ConflictException(string message) : base(message) { }
}

/// <summary>Thrown when a guess is submitted or changed after the daily set's hard lock.</summary>
public sealed class SubmissionLockedException : AppException
{
    public SubmissionLockedException(string message = "The submission window for this set is closed.")
        : base(message) { }
}

/// <summary>Thrown when a client exceeds a rate limit (e.g. requesting OTP codes too frequently).</summary>
public sealed class TooManyRequestsException : AppException
{
    public TooManyRequestsException(string message = "Too many requests. Please try again later.")
        : base(message) { }
}
