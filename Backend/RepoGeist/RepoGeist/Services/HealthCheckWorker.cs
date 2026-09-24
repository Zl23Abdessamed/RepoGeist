using Microsoft.AspNetCore.SignalR;
using Repogeist.Core;
using Repogeist.Hubs;

namespace Repogeist.Services;

/// <summary>
/// Periodically pings each repo's registered live-demo URL and records/broadcasts the
/// result — Tier 1's "uptime monitor" (Guide.md §4.5). Simple recurring work, so a plain
/// BackgroundService is the right tool here rather than Hangfire (TechGuide.md §2.3).
///
/// IRepoRepository/IHealthCheckRepository are scoped services (they wrap a scoped
/// DbContext), but BackgroundService itself is registered as a singleton — so each
/// sweep resolves its own DI scope via IServiceScopeFactory rather than injecting those
/// repositories directly into the constructor.
/// </summary>
public class HealthCheckWorker : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan PingTimeout = TimeSpan.FromSeconds(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<HealthHub> _hubContext;
    private readonly HttpClient _httpClient;
    private readonly ILogger<HealthCheckWorker> _logger;

    public HealthCheckWorker(
        IServiceScopeFactory scopeFactory,
        IHubContext<HealthHub> hubContext,
        IHttpClientFactory httpClientFactory,
        ILogger<HealthCheckWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _hubContext = hubContext;
        _logger = logger;

        // Named client so callers can configure timeouts/handlers for health-check
        // traffic specifically (e.g. via Program.cs's AddHttpClient("HealthCheck", ...))
        // without affecting HttpClients used elsewhere (GitHubService, etc.).
        _httpClient = httpClientFactory.CreateClient("HealthCheck");
        _httpClient.Timeout = PingTimeout;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunHealthCheckSweepAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A single bad sweep (e.g. a transient DB blip) shouldn't kill the
                // worker permanently — log and try again next interval.
                _logger.LogError(ex, "Health check sweep failed.");
            }

            try
            {
                await Task.Delay(CheckInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Expected on shutdown.
            }
        }
    }

    private async Task RunHealthCheckSweepAsync(CancellationToken stoppingToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var repoRepository = scope.ServiceProvider.GetRequiredService<IRepoRepository>();
        var healthCheckRepository = scope.ServiceProvider.GetRequiredService<IHealthCheckRepository>();

        var allRepos = await repoRepository.GetAllAsync();

        // Only repos with a registered live demo URL are worth pinging — matches
        // backend.md §6.6's "filter in-memory to repos with a non-null LiveDemoUrl".
        var reposWithLiveDemo = allRepos
            .Where(r => !string.IsNullOrWhiteSpace(r.LiveDemoUrl))
            .ToList();

        foreach (var repo in reposWithLiveDemo)
        {
            if (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            var check = await CheckRepoHealthAsync(repo);
            await RecordAndBroadcastAsync(check, healthCheckRepository);
        }
    }

    /// <summary>
    /// Pings repo.LiveDemoUrl and builds the HealthCheck record. Does not persist or
    /// broadcast itself — see backend.md §6.6.
    /// </summary>
    public async Task<HealthCheck> CheckRepoHealthAsync(Repo repo)
    {
        var check = new HealthCheck
        {
            Id = Guid.NewGuid(),
            RepoId = repo.Id,
            CheckedAt = DateTime.UtcNow
        };

        if (string.IsNullOrWhiteSpace(repo.LiveDemoUrl))
        {
            check.Status = HealthStatus.Unknown;
            return check;
        }

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Head, repo.LiveDemoUrl);
            using var response = await _httpClient.SendAsync(request);
            stopwatch.Stop();

            // Some servers reject HEAD requests (405) even though the site is up —
            // fall back to a GET before concluding the site is actually down.
            if (!response.IsSuccessStatusCode && response.StatusCode == System.Net.HttpStatusCode.MethodNotAllowed)
            {
                stopwatch.Restart();
                using var getRequest = new HttpRequestMessage(HttpMethod.Get, repo.LiveDemoUrl);
                using var getResponse = await _httpClient.SendAsync(getRequest);
                stopwatch.Stop();

                check.Status = getResponse.IsSuccessStatusCode ? HealthStatus.Up : HealthStatus.Down;
                check.ResponseTimeMs = (int)stopwatch.ElapsedMilliseconds;
                return check;
            }

            check.Status = response.IsSuccessStatusCode ? HealthStatus.Up : HealthStatus.Down;
            check.ResponseTimeMs = (int)stopwatch.ElapsedMilliseconds;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            // Connection failure or timeout — the demo is unreachable, not "unknown".
            stopwatch.Stop();
            check.Status = HealthStatus.Down;
            check.ResponseTimeMs = null;
        }

        return check;
    }

    /// <summary>
    /// Persists the check via IHealthCheckRepository, then broadcasts it over HealthHub
    /// — see backend.md §6.6.
    /// </summary>
    public async Task RecordAndBroadcastAsync(HealthCheck check, IHealthCheckRepository healthCheckRepository)
    {
        await healthCheckRepository.AddAsync(check);

        var dto = new HealthStatusDto
        {
            RepoId = check.RepoId,
            Status = check.Status,
            ResponseTimeMs = check.ResponseTimeMs,
            CheckedAt = check.CheckedAt
        };

        await _hubContext.BroadcastHealthUpdateAsync(dto);
    }
}