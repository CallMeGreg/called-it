using CalledIt.Migrator;

return await MigrationCommand.RunAsync(
    args, Environment.GetEnvironmentVariable(MigrationCommand.ConnectionVariable), Console.Out, Console.Error);
