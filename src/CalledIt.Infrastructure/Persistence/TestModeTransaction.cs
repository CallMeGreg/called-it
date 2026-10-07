using System.Data;
using CalledIt.Application.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Infrastructure.Persistence;

public sealed class TestModeTransaction(AppDbContext db) : ITestModeTransaction
{
    public async Task<T> ExecuteAsync<T>(Func<Task<T>> action, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

        // The write lock is held until commit/rollback, including on SQL Server across revisions.
        // It must be the first statement so SQLite never upgrades a stale read transaction.
        var affected = await db.TestModeLocks.Where(l => l.Id == 1)
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.Version, l => l.Version + 1), ct);
        if (affected != 1)
        {
            throw new InvalidOperationException("The TEST transaction gate is missing. Apply database migrations.");
        }

        var result = await action();
        await transaction.CommitAsync(ct);
        return result;
    }
}
