using Hangfire;
using Hangfire.PostgreSql;
using Microsoft.EntityFrameworkCore;
using Octokit;
using Repogeist.Core;
using Repogeist.Data;
using Repogeist.Data.Repositories;
using Repogeist.Hubs;
using Repogeist.Jobs;
using Repogeist.Services;

var builder = WebApplication.CreateBuilder(args);

// ─────────────────────────────────────────────────────────────────────────
// Controllers + OpenAPI
// ─────────────────────────────────────────────────────────────────────────

// Apply JSON options directly to the MVC Controllers
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // This tells the serializer to write `null` when it detects a loop, preventing the crash
        options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
    });

// Note: You can safely delete the old builder.Services.Configure<Microsoft.AspNetCore.Http.Json.JsonOptions> block
// Built-in Microsoft.AspNetCore.OpenApi (backend.md §2.5/§4) — generates the spec that
// openapi-typescript consumes on the frontend build step (TechGuide.md §1.9). No
// Swashbuckle needed alongside this; pick one, and this is the one backend.md lists
// as the current choice.
builder.Services.AddOpenApi();

// ─────────────────────────────────────────────────────────────────────────
// Database (PostgreSQL via EF Core + Npgsql)
// ─────────────────────────────────────────────────────────────────────────

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException(
        "Missing 'ConnectionStrings:DefaultConnection' — set it in appsettings.Development.json " +
        "(gitignored) locally, or via an environment variable / secrets manager in production.");

builder.Services.AddDbContext<RepogeistDbContext>(options =>
    options.UseNpgsql(connectionString));

// ─────────────────────────────────────────────────────────────────────────
// GitHub integration (Octokit.net)
// ─────────────────────────────────────────────────────────────────────────
//
// ── WHERE THE GITHUB TOKEN GOES ─────────────────────────────────────────
// This PAT belongs to the app, not to any user (Guide.md §4.2) — it only exists to
// raise the GitHub API rate limit from 60/hr to 5,000/hr, and is NEVER sent to the
// frontend. Configuration is read from "GitHub:AccessToken", which resolves (in order
// of precedence, later wins) from:
//   1. appsettings.json                → leave this key absent/empty; never commit a
//                                         real token here.
//   2. appsettings.Development.json    → gitignored locally. Put the real token here
//                                         for local dev: { "GitHub": { "AccessToken":
//                                         "ghp_xxx" } }.
//   3. .NET user-secrets (alternative to Development.json for local dev):
//        dotnet user-secrets init
//        dotnet user-secrets set "GitHub:AccessToken" "ghp_xxx"
//   4. Environment variable in production: GitHub__AccessToken=ghp_xxx (the double
//      underscore is ASP.NET Core's config-key path separator for env vars). This is
//      how you inject it from a secrets manager / your host's secret store at deploy
//      time — Docker Compose `environment:`/`env_file`, a Kubernetes Secret, etc.
// Generate the token at https://github.com/settings/tokens with **no scopes checked**
// (public-data-only access doesn't need any of the repo/private scopes) — a
// fine-grained PAT with "Public Repositories (read-only)" access works too.
// ─────────────────────────────────────────────────────────────────────────
var gitHubToken = builder.Configuration["GitHub:AccessToken"];

builder.Services.AddSingleton<IGitHubClient>(_ =>
{
    var client = new GitHubClient(new ProductHeaderValue("Repogeist"));

    if (!string.IsNullOrWhiteSpace(gitHubToken))
    {
        client.Credentials = new Credentials(gitHubToken);
    }
    // else: falls back to unauthenticated 60/hr rate limit — fine for first boot/dev
    // without a token yet, but log it so it's not silently forgotten in production.

    return client;
});

// ─────────────────────────────────────────────────────────────────────────
// HttpClient for HealthCheckWorker's live-demo pings (TechGuide.md §2.7, Guide.md §4.5)
// ─────────────────────────────────────────────────────────────────────────

builder.Services.AddHttpClient("HealthCheck", client =>
{
    // Timeout is also set explicitly per-request in HealthCheckWorker (PingTimeout),
    // this is just a sane factory-level default in case that ever changes.
    client.Timeout = TimeSpan.FromSeconds(15);
});

// ─────────────────────────────────────────────────────────────────────────
// Repositories, services, and the health-check background worker
// ─────────────────────────────────────────────────────────────────────────

builder.Services.AddScoped<IRepoRepository, RepoRepository>();
builder.Services.AddScoped<IHealthCheckRepository, HealthCheckRepository>();
builder.Services.AddScoped<IAnalysisRepository, AnalysisRepository>();
builder.Services.AddScoped<ICloneRepository, CloneRepository>();

builder.Services.AddScoped<IGitHubService, GitHubService>();
builder.Services.AddSingleton<IMarkdownRenderer, MarkdownRenderer>();

// CloneService owns the actual git-clone mechanics, shared by CloneJobs (fires
// automatically on ingestion) and AnalysisJobs (verifies/repairs a clone before
// analyzing) — Guide.md §5.0. Scoped, not singleton: it depends on ICloneRepository,
// which itself depends on the (scoped, per-request/per-job) RepogeistDbContext.
builder.Services.AddScoped<ICloneService, CloneService>();

// Clone and analysis are two separate background job types (Guide.md §5.0) —
// registered as plain scoped services so Hangfire can resolve them per job execution
// (BackgroundJob.Enqueue<CloneJobs>(...) / BackgroundJob.Enqueue<AnalysisJobs>(...)
// in ReposController / AnalysisController resolve a fresh instance, with a fresh
// DbContext, per job run).
builder.Services.AddScoped<CloneJobs>();
builder.Services.AddScoped<AnalysisJobs>();

// TIER 2 ANALYZERS DELIBERATELY NOT IMPLEMENTED YET — no real IAnalyzerResolver/
// ILanguageAnalyzer implementation exists in this pass (see AnalysisController.cs's
// class doc comment). AnalysisJobs still needs *something* registered for
// IAnalyzerResolver, though: without any registration at all, the DI container can't
// construct AnalysisJobs, and design-time tooling that builds the whole service
// provider (e.g. `dotnet ef migrations add`) fails before it ever reaches the
// DbContext — even though migrations have nothing to do with analyzers.
// NoOpAnalyzerResolver.Resolve always returns null, which
// AnalysisJobs.RunAnalysisJobAsync already handles gracefully (marks the job Failed
// with "Unsupported language" rather than throwing), so the clone/queue/broadcast
// pipeline around it is safe to run end-to-end without a real analyzer. Replace this
// one line (don't register both) once the analyzer projects
// (Repogeist.Analyzers.CSharp / Repogeist.Analyzers.JavaScript, or the Analyzers/
// folders — see TechGuide.md §2.4 vs. §5's open question) land:
//
//   builder.Services.AddScoped<IAnalyzerResolver, AnalyzerResolver>();
//   builder.Services.AddScoped<ILanguageAnalyzer, CSharpAnalyzer>();
//   builder.Services.AddScoped<ILanguageAnalyzer, JavaScriptAnalyzer>();
builder.Services.AddScoped<IAnalyzerResolver, NoOpAnalyzerResolver>();

// Simple recurring work (health checks) is a plain hosted BackgroundService
// (TechGuide.md §2.3) — registered directly, not behind an interface, since nothing
// else needs to resolve it as a dependency.
builder.Services.AddHostedService<HealthCheckWorker>();

// ─────────────────────────────────────────────────────────────────────────
// Hangfire (queued, retry-worthy background jobs — TechGuide.md §2.3)
// ─────────────────────────────────────────────────────────────────────────
//
// Heavier work (cloning, analysis) goes through Hangfire rather than a bare
// BackgroundService, for retry logic, progress tracking, and the dashboard — unlike
// health checks above, which are simple recurring polling and don't need any of that.
// Reuses the same Postgres connection string as EF Core; Hangfire manages its own
// schema/tables inside that database (via UsePostgreSqlStorage), separate from the
// RepogeistDbContext-owned tables.
builder.Services.AddHangfire(config => config
    .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UsePostgreSqlStorage(pg => pg.UseNpgsqlConnection(connectionString)));

builder.Services.AddHangfireServer();

// ─────────────────────────────────────────────────────────────────────────
// SignalR (real-time push for health, clone, and analysis — TechGuide.md §1.7/§2.7)
// ─────────────────────────────────────────────────────────────────────────

builder.Services.AddSignalR();

// ─────────────────────────────────────────────────────────────────────────
// CORS — the SolidStart frontend runs on a different origin in dev
// ─────────────────────────────────────────────────────────────────────────

const string FrontendCorsPolicy = "FrontendCorsPolicy";

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        var allowedOrigins = builder.Configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>() ?? ["http://localhost:3000"];

        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials(); // required for SignalR's WebSocket handshake
    });
});

var app = builder.Build();

// ─────────────────────────────────────────────────────────────────────────
// Middleware pipeline
// ─────────────────────────────────────────────────────────────────────────

if (app.Environment.IsDevelopment())
{
    // GET /openapi/v1.json — consumed by the frontend's openapi-typescript build step
    // (TechGuide.md §1.9). Kept dev-only; expose behind auth if you ever need it in
    // production.
    app.MapOpenApi();

    // Hangfire's built-in dashboard (TechGuide.md §2.3 — "shows you running/failed/
    // queued jobs for free"). Dev-only here for the same reason as MapOpenApi above;
    // add authorization filters before ever exposing this in production, since by
    // default it's unauthenticated.
    app.MapHangfireDashboard("/hangfire");
}

//app.UseHttpsRedirection();

app.UseCors(FrontendCorsPolicy);

app.UseAuthorization();

app.MapControllers();

// SignalR hubs (backend.md §3 / TechGuide.md §4.2). Clone and analysis are kept as
// separate hubs, matching them being two separate job types with independent status
// (Guide.md §5.0) — a person watching a repo they just added and a person waiting on
// an "Analyze" click are two different moments, not one "processing" concept.
app.MapHub<HealthHub>("/hub/health");
app.MapHub<CloneHub>("/hub/clone");
app.MapHub<AnalysisHub>("/hub/analysis");

app.Run();