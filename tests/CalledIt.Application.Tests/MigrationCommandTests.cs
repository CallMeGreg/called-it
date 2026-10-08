using CalledIt.Migrator;

namespace CalledIt.Application.Tests;

public sealed class MigrationCommandTests
{
    [Theory]
    [InlineData("migrate")]
    [InlineData("seed-categories")]
    public async Task Writes_require_apply_before_connecting(string command)
    {
        using var error = new StringWriter();
        var result = await MigrationCommand.RunAsync(
            [command, "--database", "calledit"], null, TextWriter.Null, error);
        Assert.Equal(2, result);
        Assert.Contains("--apply", error.ToString());
    }

    [Theory]
    [InlineData("status")]
    [InlineData("migrate")]
    [InlineData("seed-categories")]
    public async Task No_runtime_connection_fallback(string command)
    {
        using var error = new StringWriter();
        string[] args = command == "status"
            ? [command, "--database", "calledit"]
            : [command, "--database", "calledit", "--apply"];
        Assert.Equal(2, await MigrationCommand.RunAsync(args, null, TextWriter.Null, error));
        Assert.Contains(MigrationCommand.ConnectionVariable, error.ToString());
    }

    [Theory]
    [InlineData("Server=localhost;Database=master", "master")]
    [InlineData("Server=localhost;Database=MSDB", "MSDB")]
    [InlineData("Server=localhost;Database=model", "model")]
    [InlineData("Server=localhost;Database=tempdb", "tempdb")]
    [InlineData("Server=localhost;Database=calledit", "different")]
    [InlineData("Server=localhost", "calledit")]
    [InlineData("Database=calledit", "calledit")]
    [InlineData("Server=localhost;Database=calledit;AttachDbFilename=test.mdf", "calledit")]
    public async Task Rejects_ambiguous_or_system_targets_without_disclosing_credentials(string connection, string target)
    {
        var secret = Guid.NewGuid().ToString("N");
        using var error = new StringWriter();
        Assert.Equal(2, await MigrationCommand.RunAsync(
            ["migrate", "--database", target, "--apply"], connection + $";Password={secret}", TextWriter.Null, error));
        Assert.Contains("non-system database", error.ToString());
        Assert.DoesNotContain(secret, error.ToString());
    }

    [Fact]
    public async Task Malformed_connection_is_reported_without_echoing_it()
    {
        var secret = Guid.NewGuid().ToString("N");
        using var error = new StringWriter();
        Assert.Equal(2, await MigrationCommand.RunAsync(
            ["status", "--database", "calledit"], $"Password={secret};UnsupportedOption=true", TextWriter.Null, error));
        Assert.Contains("Invalid migrator connection", error.ToString());
        Assert.DoesNotContain(secret, error.ToString());
    }

    [Fact]
    public async Task Review_script_is_offline_and_idempotent()
    {
        using var output = new StringWriter();
        using var error = new StringWriter();
        Assert.Equal(0, await MigrationCommand.RunAsync(["script"], null, output, error));
        Assert.Equal("", error.ToString());
        Assert.Contains("__EFMigrationsHistory", output.ToString());
        Assert.Contains("IF NOT EXISTS", output.ToString());
        Assert.Contains("Latin1_General_100_BIN2", output.ToString());
        Assert.DoesNotContain("CREATE DATABASE", output.ToString());
    }
}
