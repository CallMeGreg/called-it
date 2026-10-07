using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace CalledIt.Application.Tests;

public sealed class TestHostEnvironment(string name = "Development") : IHostEnvironment
{
    public string EnvironmentName { get; set; } = name;
    public string ApplicationName { get; set; } = "CalledIt.Tests";
    public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}
