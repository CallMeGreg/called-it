using CalledIt.Application;
using CalledIt.Infrastructure;
using CalledIt.Workers;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddApplication(builder.Configuration);
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.Configure<WorkerOptions>(builder.Configuration.GetSection(WorkerOptions.SectionName));

var options = builder.Configuration.GetSection(WorkerOptions.SectionName).Get<WorkerOptions>() ?? new WorkerOptions();

if (options.EnableDailySetBuilder)
{
    builder.Services.AddHostedService<DailySetBuilderWorker>();
}

if (options.EnableResolver)
{
    builder.Services.AddHostedService<ResolverWorker>();
}

if (options.EnableWindowClosing)
{
    builder.Services.AddHostedService<WindowClosingWorker>();
}

var host = builder.Build();
host.Run();
