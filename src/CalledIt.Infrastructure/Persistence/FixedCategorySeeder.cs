using System.Data;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Infrastructure.Persistence;

public static class FixedCategorySeeder
{
    public static async Task SeedAsync(AppDbContext db, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        if (db.Database.IsSqlServer())
        {
            // Serialize even the empty-table case; uniqueness alone cannot make concurrent seeds succeed.
            await db.Database.ExecuteSqlRawAsync("""
                DECLARE @result int;
                EXEC @result = sys.sp_getapplock
                    @Resource = N'CalledIt.FixedCategories',
                    @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 25000;
                IF @result < 0 THROW 51000, 'Could not acquire the fixed-category seed lock.', 1;
                """, ct);
        }

        var existing = await db.Categories.ToListAsync(ct);
        if (existing.Any(category => Categories.All.Any(code =>
                string.Equals(category.Code.Trim(), code, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(category.Code, code, StringComparison.Ordinal))))
        {
            throw new InvalidOperationException(
                "Noncanonical fixed category codes exist. Review and repair them before seeding; no rows were changed.");
        }

        foreach (var code in Categories.All)
        {
            if (!existing.Any(category => string.Equals(category.Code, code, StringComparison.Ordinal)))
            {
                db.Categories.Add(new Category { Code = code, DisplayName = Categories.DisplayName(code) });
            }
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }
}
