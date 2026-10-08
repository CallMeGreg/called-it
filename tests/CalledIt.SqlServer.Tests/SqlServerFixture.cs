using System.Diagnostics;
using CalledIt.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace CalledIt.SqlServer.Tests;

[CollectionDefinition(Name)]
public sealed class SqlServerCollection : ICollectionFixture<SqlServerFixture>
{
    public const string Name = "SQL Server";
}

public sealed class SqlServerFixture : IAsyncLifetime
{
    public const string ConnectionVariable = "CALLEDIT_SQLSERVER_TEST_CONNECTION_STRING";
    private string _masterConnection = "";
    public string ServerVersion { get; private set; } = "";

    public async Task InitializeAsync()
    {
        var value = Environment.GetEnvironmentVariable(ConnectionVariable);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException(
                $"Set {ConnectionVariable} to a disposable local SQL Server. These tests never skip or substitute SQLite.");
        }
        SqlConnectionStringBuilder connection;
        try
        {
            connection = new SqlConnectionStringBuilder(value);
        }
        catch (ArgumentException)
        {
            throw new InvalidOperationException($"Invalid {ConnectionVariable}; connection values are intentionally not logged.");
        }
        var host = connection.DataSource.Replace("tcp:", "", StringComparison.OrdinalIgnoreCase).Split(',')[0];
        if (host is not ("localhost" or "127.0.0.1")
            || (connection.InitialCatalog.Length != 0 && connection.InitialCatalog != "master")
            || connection.AttachDBFilename.Length != 0)
        {
            throw new InvalidOperationException("SQL tests accept only loopback servers and an empty/master catalog, never an application database.");
        }
        connection.InitialCatalog = "master";
        connection.ApplicationName = "CalledIt.SqlServer.Tests";
        connection.Pooling = false;
        connection.ConnectTimeout = 3;
        connection.ConnectRetryCount = 0;
        _masterConnection = connection.ConnectionString;

        var timer = Stopwatch.StartNew();
        int? lastError = null;
        while (timer.Elapsed < TimeSpan.FromSeconds(90))
        {
            await using var probe = new SqlConnection(_masterConnection);
            try
            {
                await probe.OpenAsync();
                ServerVersion = probe.ServerVersion;
                return;
            }
            catch (SqlException ex)
            {
                lastError = ex.Number;
                await Task.Delay(TimeSpan.FromSeconds(1));
            }
        }
        throw new InvalidOperationException($"SQL Server did not become ready within 90 seconds (last SQL error {lastError}).");
    }

    public async Task<SqlTestDatabase> CreateDatabaseAsync()
    {
        var name = $"calledit_test_{Guid.NewGuid():N}";
        await using var connection = new SqlConnection(_masterConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE DATABASE [{name}] COLLATE SQL_Latin1_General_CP1_CI_AS;";
        await command.ExecuteNonQueryAsync();
        var database = new SqlTestDatabase(_masterConnection, name);
        try
        {
            command.CommandText = $"ALTER DATABASE [{name}] SET READ_COMMITTED_SNAPSHOT ON;";
            await command.ExecuteNonQueryAsync();
            return database;
        }
        catch (SqlException)
        {
            await database.DisposeAsync();
            throw;
        }
    }

    public Task DisposeAsync() => Task.CompletedTask;
}

public sealed class SqlTestDatabase : IAsyncDisposable
{
    private readonly string _masterConnection;
    public string Name { get; }
    public string ConnectionString { get; }

    internal SqlTestDatabase(string masterConnection, string name)
    {
        _masterConnection = masterConnection;
        Name = name;
        ConnectionString = new SqlConnectionStringBuilder(masterConnection) { InitialCatalog = name }.ConnectionString;
    }

    public AppDbContext CreateContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(ConnectionString)
            .AddInterceptors(interceptors).Options);

    public async ValueTask DisposeAsync()
    {
        await using var connection = new SqlConnection(_masterConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        // Name is generated internally, never taken from the connection string or test input.
        command.CommandText = $"ALTER DATABASE [{Name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{Name}];";
        await command.ExecuteNonQueryAsync();
    }
}
