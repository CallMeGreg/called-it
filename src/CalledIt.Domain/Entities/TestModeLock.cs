namespace CalledIt.Domain.Entities;

/// <summary>A singleton row updated to take an exclusive, transaction-scoped database lock.</summary>
public class TestModeLock
{
    public int Id { get; set; } = 1;
    public long Version { get; set; }
}
