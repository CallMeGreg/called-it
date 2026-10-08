using CalledIt.Domain;
using CalledIt.Domain.Entities;
using CalledIt.Infrastructure.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Tests;

public sealed class FixedCategorySeederTests
{
    [Fact]
    public async Task Repeated_partial_seed_preserves_existing_ids_names_and_unrelated_data()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var existing = new Category { Code = Categories.Sports, DisplayName = "Reviewed sports name" };
        db.Categories.Add(existing);
        await db.SaveChangesAsync();

        await FixedCategorySeeder.SeedAsync(db);
        var ids = await db.Categories.OrderBy(c => c.Code).Select(c => c.Id).ToListAsync();
        await FixedCategorySeeder.SeedAsync(db);

        Assert.Equal(ids, await db.Categories.OrderBy(c => c.Code).Select(c => c.Id).ToListAsync());
        Assert.Equal(3, ids.Count);
        Assert.Equal("Reviewed sports name", (await db.Categories.SingleAsync(c => c.Id == existing.Id)).DisplayName);
        Assert.Empty(await db.ResolutionSources.ToListAsync());
        Assert.Empty(await db.Users.ToListAsync());
    }

    [Theory]
    [InlineData("SPORTS")]
    [InlineData("sports ")]
    [InlineData(" sports")]
    public async Task Noncanonical_existing_codes_fail_without_partial_seed(string code)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.Categories.Add(new Category { Code = code, DisplayName = "Existing" });
        await db.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => FixedCategorySeeder.SeedAsync(db));
        Assert.Contains("Noncanonical", error.Message);
        Assert.Equal(code, Assert.Single(await db.Categories.ToListAsync()).Code);
    }
}
