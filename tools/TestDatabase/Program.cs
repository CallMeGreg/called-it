using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

internal static partial class Program
{
    private const string Subscription = "b5ccc8c6-8222-4b70-83a3-3d7de1e5920f";
    private const string RunGroup = "called-it-test-run";
    private const string RuntimeName = "called-it-test-runtime";

    private static async Task<int> Main(string[] args)
    {
        if (args.SequenceEqual(new[] { "--self-test" }))
        {
            SelfTest();
            Console.WriteLine("SQL bootstrap helper self-tests passed.");
            return 0;
        }

        var stage = "configuration";
        try
        {
            Require(args.Length == 0, "The migration image accepts no overrides.");
            Require(Environment.GetEnvironmentVariable("TEST_SUBSCRIPTION_ID") == Subscription
                && Environment.GetEnvironmentVariable("TEST_RUN_GROUP") == RunGroup,
                "Migration is restricted to the approved TEST scope.");
            var server = Required("SQL_SERVER");
            Require(ServerPattern().IsMatch(server), "Unexpected TEST SQL hostname.");
            Require(Required("SQL_DATABASE") == "calledit", "Unexpected TEST database.");
            Require(Required("RUNTIME_IDENTITY_NAME") == RuntimeName, "Unexpected runtime identity name.");
            var runtimePrincipal = Guid.Parse(Required("RUNTIME_PRINCIPAL_ID"));
            var migratorClient = Guid.Parse(Required("AZURE_CLIENT_ID"));

            stage = "private DNS";
            var addresses = await Dns.GetHostAddressesAsync(server);
            Require(addresses.Length > 0 && addresses.All(IsPrivate), "SQL must resolve exclusively to private addresses.");

            var connectionString = new SqlConnectionStringBuilder
            {
                DataSource = $"tcp:{server},1433",
                InitialCatalog = "calledit",
                Authentication = SqlAuthenticationMethod.ActiveDirectoryManagedIdentity,
                UserID = migratorClient.ToString(),
                Encrypt = SqlConnectionEncryptOption.Mandatory,
                TrustServerCertificate = false,
                ConnectTimeout = 30,
                ApplicationName = "CalledIt.TestDatabase",
            };
            await using var connection = new SqlConnection(connectionString.ConnectionString);
            stage = "managed-identity connection";
            await connection.OpenAsync();

            stage = "contained runtime user";
            var sid = $"0x{Convert.ToHexString(runtimePrincipal.ToByteArray())}";
            await Execute(connection, $$"""
                IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'{{RuntimeName}}' AND (sid <> {{sid}} OR type <> 'E'))
                    THROW 51000, 'Existing runtime user does not match the reviewed managed identity.', 1;
                IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'{{RuntimeName}}')
                    CREATE USER [{{RuntimeName}}] WITH SID = {{sid}}, TYPE = E;
                IF IS_ROLEMEMBER(N'db_datareader', N'{{RuntimeName}}') <> 1
                    ALTER ROLE db_datareader ADD MEMBER [{{RuntimeName}}];
                IF IS_ROLEMEMBER(N'db_datawriter', N'{{RuntimeName}}') <> 1
                    ALTER ROLE db_datawriter ADD MEMBER [{{RuntimeName}}];
                IF EXISTS (
                    SELECT 1 FROM sys.database_role_members m
                    JOIN sys.database_principals r ON m.role_principal_id = r.principal_id
                    JOIN sys.database_principals u ON m.member_principal_id = u.principal_id
                    WHERE u.name = N'{{RuntimeName}}' AND r.name NOT IN (N'db_datareader', N'db_datawriter')
                )
                    THROW 51001, 'Runtime identity has unexpected database roles; refusing deployment.', 1;
                """);

            stage = "schema migration";
            var script = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "migrations.sql"));
            Require(script.Contains("__EFMigrationsHistory", StringComparison.Ordinal)
                && script.Contains("20261007031337_AddIsolatedTestRounds", StringComparison.Ordinal),
                "The image must contain the idempotent TEST schema migration.");
            var batches = SplitBatches(script);
            foreach (var batch in batches)
                await Execute(connection, batch);

            stage = "runtime permission verification";
            await Execute(connection, $$"""
                EXECUTE AS USER = N'{{RuntimeName}}';
                IF HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') = 1
                   OR HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER ANY USER') = 1
                    THROW 51002, 'Runtime identity must not have DDL or user-management permissions.', 1;
                SELECT TOP (0) * FROM dbo.__EFMigrationsHistory;
                REVERT;
                """);
            Console.WriteLine("Private TEST database bootstrap and idempotent migrations succeeded.");
            return 0;
        }
        catch (SqlException error)
        {
            Console.Error.WriteLine($"TEST database {stage} failed: SQL error {error.Number}, state {error.State}. Credentials and SQL payloads are not logged.");
        }
        catch (Exception error) when (error is InvalidOperationException or FormatException or IOException or System.Net.Sockets.SocketException)
        {
            Console.Error.WriteLine($"TEST database {stage} failed ({error.GetType().Name}). Check the reviewed image, configuration, private DNS, and job identity.");
        }
        return 1;
    }

    private static async Task Execute(SqlConnection connection, string text)
    {
        await using var command = new SqlCommand(text, connection) { CommandTimeout = 180 };
        await command.ExecuteNonQueryAsync();
    }

    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
            ? value : throw new InvalidOperationException($"Missing {name}.");

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    internal static bool IsPrivate(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes.Length == 4
            && (bytes[0] == 10 || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) || (bytes[0] == 192 && bytes[1] == 168));
    }

    internal static string[] SplitBatches(string script)
    {
        Require(!SqlCmdDirective().IsMatch(script), "SQLCMD directives are not accepted in migration images.");
        return BatchSeparator().Split(script).Where(batch => !string.IsNullOrWhiteSpace(batch)).ToArray();
    }

    private static void SelfTest()
    {
        Require(IsPrivate(IPAddress.Parse("10.42.1.4")), "Private endpoint address rejected.");
        Require(!IsPrivate(IPAddress.Parse("20.42.1.4")), "Public SQL address accepted.");
        Require(!IsPrivate(IPAddress.Parse("127.0.0.1")), "Loopback SQL address accepted.");
        Require(!IsPrivate(IPAddress.IPv6Loopback), "IPv6 loopback accepted.");
        Require(SplitBatches("SELECT 1;\nGO\nSELECT 2;\r\nGO -- batch\r\n").Length == 2, "EF GO batches not parsed.");
        Require(Convert.ToHexString(Guid.Parse("00112233-4455-6677-8899-aabbccddeeff").ToByteArray())
            == "33221100554477668899AABBCCDDEEFF", "Entra SID byte order changed.");
        try
        {
            SplitBatches(":r another-file.sql\n");
            throw new InvalidOperationException("SQLCMD file inclusion accepted.");
        }
        catch (InvalidOperationException error) when (error.Message == "SQLCMD directives are not accepted in migration images.") { }
    }

    [GeneratedRegex(@"^called-it-test-sql-[a-z0-9]+\.database\.windows\.net$")]
    private static partial Regex ServerPattern();

    [GeneratedRegex(@"^\s*GO\s*(?:--[^\r\n]*)?\r?$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex BatchSeparator();

    [GeneratedRegex(@"^\s*:", RegexOptions.Multiline)]
    private static partial Regex SqlCmdDirective();
}
