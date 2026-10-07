using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using CalledIt.Api.Infrastructure;
using CalledIt.Application;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Infrastructure;
using CalledIt.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddApplication(builder.Configuration, builder.Environment.EnvironmentName);
builder.Services.AddInfrastructure(builder.Configuration);

// --- Authentication (JWT bearer, matching the tokens issued by JwtTokenService) ---
var auth = builder.Configuration.GetSection(AuthOptions.SectionName).Get<AuthOptions>() ?? new AuthOptions();
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = auth.Issuer,
            ValidateAudience = true,
            ValidAudience = auth.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(string.IsNullOrWhiteSpace(auth.SigningKey)
                    ? new string('0', 32)
                    : auth.SigningKey)),
            NameClaimType = "sub",
            RoleClaimType = ClaimTypes.Role,
            ClockSkew = TimeSpan.FromSeconds(30),
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var testMode = context.HttpContext.RequestServices.GetRequiredService<IOptions<TestModeOptions>>().Value;
                var inviteId = context.Principal?.FindFirst(TestModeOptions.InviteClaim)?.Value;
                if (testMode.Enabled)
                {
                    if (inviteId is null || !testMode.Invites.Any(i => i.Id == inviteId)
                        || !Guid.TryParse(context.Principal?.FindFirst("sub")?.Value, out var userId)
                        || context.Principal!.IsInRole("Admin"))
                    {
                        context.Fail("A configured TEST invite account is required.");
                        return;
                    }

                    var db = context.HttpContext.RequestServices.GetRequiredService<IAppDbContext>();
                    if (!await db.Users.AnyAsync(u => u.Id == userId && u.TestInviteId == inviteId
                        && !u.IsAdmin && !u.DiscoverableByPhone && u.PhoneE164 == null && u.PhoneHash == null,
                        context.HttpContext.RequestAborted))
                    {
                        context.Fail("This TEST account is not available.");
                    }
                }
                else if (inviteId is not null)
                {
                    context.Fail("TEST tokens are not valid outside TEST mode.");
                }
            },
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("test-login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(5),
            QueueLimit = 0,
        }));
    options.OnRejected = async (context, ct) =>
    {
        await Results.Problem(
            statusCode: StatusCodes.Status429TooManyRequests,
            title: "Too many requests",
            detail: "Too many TEST login attempts. Please try again later.")
            .ExecuteAsync(context.HttpContext);
    };
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Called It API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
    });
    c.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", document)] = new List<string>(),
    });
});

var app = builder.Build();

// Prepare the database (create/seed for SQLite dev/test, migrate for SQL Server).
using (var scope = app.Services.CreateScope())
{
    var initializer = scope.ServiceProvider.GetRequiredService<DbInitializer>();
    await initializer.InitializeAsync();
}

app.UseMiddleware<ExceptionHandlingMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

// Keep API/health paths out of static serving, even if the web export has matching files.
app.UseWhen(context => !context.Request.Path.StartsWithSegments("/api")
    && !context.Request.Path.StartsWithSegments("/health"), web =>
{
    web.UseDefaultFiles();
    web.UseStaticFiles();
});
app.MapControllers();
app.MapFallback(async context =>
{
    var path = context.Request.Path;
    var index = app.Environment.WebRootFileProvider.GetFileInfo("index.html");
    if ((!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        || path.StartsWithSegments("/api") || path.StartsWithSegments("/health")
        || Path.HasExtension(path.Value) || !index.Exists)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.ContentType = "text/html; charset=utf-8";
    context.Response.Headers.CacheControl = "no-cache";
    await context.Response.SendFileAsync(index, context.RequestAborted);
});

app.Run();

/// <summary>Exposed so integration tests can host the API with <c>WebApplicationFactory</c>.</summary>
public partial class Program;
