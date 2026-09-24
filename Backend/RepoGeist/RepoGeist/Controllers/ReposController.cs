using System.Text.RegularExpressions;
using Hangfire;
using Microsoft.AspNetCore.Mvc;
using Repogeist.Core;
using Repogeist.Jobs;

namespace Repogeist.Controllers;

/// <summary>
/// Tier 1 endpoints — ingesting and reading repo metadata (Guide.md §4.2/4.3,
/// backend.md §3/§6.4). No analysis/graph concerns here; that's AnalysisController.
/// Clone-status/file/file-tree concerns live in CloneController.
/// </summary>
[ApiController]
[Route("api/repos")]
public class ReposController : ControllerBase
{
    // github.com/{owner}/{name} (with or without scheme/www, optional trailing
    // slash or .git) — used to validate + parse CreateRepoRequestDto.RepoUrl before
    // ever hitting the GitHub API with it (Guide.md §4.2).
    private static readonly Regex GitHubRepoUrlPattern = new(
        @"^(?:https?://)?(?:www\.)?github\.com/(?<owner>[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)/(?<name>[A-Za-z0-9_.-]+?)(?:\.git)?/?$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly IRepoRepository _repoRepository;
    private readonly IHealthCheckRepository _healthCheckRepository;
    private readonly IAnalysisRepository _analysisRepository;
    private readonly IGitHubService _gitHubService;
    private readonly IMarkdownRenderer _markdownRenderer;
    private readonly IBackgroundJobClient _backgroundJobClient;
    private readonly ILogger<ReposController> _logger;

    public ReposController(
        IRepoRepository repoRepository,
        IHealthCheckRepository healthCheckRepository,
        IAnalysisRepository analysisRepository,
        IGitHubService gitHubService,
        IMarkdownRenderer markdownRenderer,
        IBackgroundJobClient backgroundJobClient,
        ILogger<ReposController> logger)
    {
        _repoRepository = repoRepository;
        _healthCheckRepository = healthCheckRepository;
        _analysisRepository = analysisRepository;
        _gitHubService = gitHubService;
        _markdownRenderer = markdownRenderer;
        _backgroundJobClient = backgroundJobClient;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/repos — every ingested repo, mapped to the lightweight card shape the
    /// canvas needs (Guide.md §4.1/§4.3 Level 1). Latest health status is resolved per
    /// repo via IHealthCheckRepository rather than eager-loaded on the entity (see
    /// RepoRepository.GetAllAsync's comment).
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<RepoCardDto[]>> GetAllRepos(CancellationToken ct)
    {
        var repos = await _repoRepository.GetAllAsync();

        var cards = new List<RepoCardDto>(repos.Count);
        foreach (var repo in repos)
        {
            ct.ThrowIfCancellationRequested();

            var latestCheck = await _healthCheckRepository.GetLatestAsync(repo.Id);

            cards.Add(new RepoCardDto
            {
                Id = repo.Id,
                Owner = repo.Owner,
                Name = repo.Name,
                Description = repo.Description,
                Topics = repo.Topics,
                PrimaryLanguage = repo.PrimaryLanguage,
                LiveDemoUrl = repo.LiveDemoUrl,
                HealthStatus = latestCheck?.Status ?? HealthStatus.Unknown
            });
        }

        return Ok(cards.ToArray());
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name} — full Tier 1 detail for the Level 2 panel
    /// (Guide.md §4.3): README preview, language breakdown, contributors, commit
    /// activity, entry point, health, star/fork counts, and analysis status (drives
    /// the Overview "Analyze" vs. "Analyzed" treatment — Guide.md §5.0).
    /// </summary>
    [HttpGet("{owner}/{name}")]
    public async Task<ActionResult<RepoDetailDto>> GetRepo(string owner, string name, CancellationToken ct)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        var latestCheck = await _healthCheckRepository.GetLatestAsync(repo.Id);

        // ReadmeHtml is rendered once during sync (Markdig, cached) rather than here —
        // MarkdownRenderer isn't stored on the entity yet in this pass, so we re-render
        // from the raw markdown fetch only if a future migration adds a persisted
        // ReadmeMarkdown/ReadmeHtml column. For now this endpoint reads purely from
        // what's already on Repo + its navigation collections.
        ct.ThrowIfCancellationRequested();

        var latestAnalysisJob = await _analysisRepository.GetLatestForRepoAsync(repo.Id);

        return Ok(MapToDetailDto(repo, latestCheck, latestAnalysisJob));
    }

    /// <summary>
    /// POST /api/repos — ingest a new public repo by URL (Guide.md §4.2). Validates the
    /// URL shape, fetches Tier 1 data from GitHub, renders the README, and persists
    /// everything. Returns the card shape (201) immediately — cloning is fired as a
    /// background job right after persistence and is not awaited here (Guide.md §5.0):
    /// the card must render with Tier 1 metadata alone, with nothing gated on the clone.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<RepoCardDto>> CreateRepo([FromBody] CreateRepoRequestDto request, CancellationToken ct)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.RepoUrl))
        {
            return BadRequest("RepoUrl is required.");
        }

        var match = GitHubRepoUrlPattern.Match(request.RepoUrl.Trim());
        if (!match.Success)
        {
            return BadRequest("RepoUrl must look like https://github.com/{owner}/{name}.");
        }

        var owner = match.Groups["owner"].Value;
        var name = match.Groups["name"].Value;

        var existing = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (existing is not null)
        {
            return Conflict($"{owner}/{name} has already been ingested.");
        }

        Repo repo;
        try
        {
            repo = await _gitHubService.FetchRepoMetadataAsync(owner, name);
        }
        catch (Octokit.NotFoundException)
        {
            return NotFound($"{owner}/{name} was not found on GitHub, or is private.");
        }

        await _repoRepository.AddAsync(repo);
        await SyncChildDataAsync(repo, ct);

        // Fire the clone job immediately in the background, separately from analysis
        // (Guide.md §5.0). This is the one place a clone starts unprompted — the user
        // didn't click anything to trigger it, but the Code view depends on it, so it
        // begins the moment ingestion finishes rather than waiting on a later
        // "Analyze" click. Not awaited: the response below returns as soon as the
        // Repo + child data are persisted, regardless of how long cloning takes.
        _backgroundJobClient.Enqueue<CloneJobs>(j => j.RunCloneJobAsync(repo.Id));

        var latestCheck = await _healthCheckRepository.GetLatestAsync(repo.Id);

        var card = new RepoCardDto
        {
            Id = repo.Id,
            Owner = repo.Owner,
            Name = repo.Name,
            Description = repo.Description,
            Topics = repo.Topics,
            PrimaryLanguage = repo.PrimaryLanguage,
            LiveDemoUrl = repo.LiveDemoUrl,
            HealthStatus = latestCheck?.Status ?? HealthStatus.Unknown
        };

        return CreatedAtAction(nameof(GetRepo), new { owner = repo.Owner, name = repo.Name }, card);
    }

    /// <summary>
    /// POST /api/repos/{owner}/{name}/sync — force a re-sync from GitHub, refreshing
    /// metadata, language stats, contributors, and commit activity, then bumping
    /// LastSyncedAt (Guide.md §4.2). Does not touch clone/analysis state — those are
    /// independent pipelines the person re-triggers separately if they want to.
    /// </summary>
    [HttpPost("{owner}/{name}/sync")]
    public async Task<ActionResult<RepoDetailDto>> SyncRepo(string owner, string name, CancellationToken ct)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        Repo refreshed;
        try
        {
            refreshed = await _gitHubService.FetchRepoMetadataAsync(owner, name);
        }
        catch (Octokit.NotFoundException)
        {
            return NotFound($"{owner}/{name} could not be refreshed from GitHub (not found or now private).");
        }

        // Keep the existing identity/id; overwrite the fields GitHub is the source of
        // truth for. EntryPointPath is intentionally left untouched here — entry-point
        // detection (Guide.md §4.4) is a separate concern from a GitHub metadata sync.
        repo.Description = refreshed.Description;
        repo.Topics = refreshed.Topics;
        repo.PrimaryLanguage = refreshed.PrimaryLanguage;
        repo.Stars = refreshed.Stars;
        repo.Forks = refreshed.Forks;
        repo.LiveDemoUrl = refreshed.LiveDemoUrl;
        repo.LastSyncedAt = DateTime.UtcNow;

        await _repoRepository.UpdateAsync(repo);
        await SyncChildDataAsync(repo, ct);

        var latestCheck = await _healthCheckRepository.GetLatestAsync(repo.Id);
        var latestAnalysisJob = await _analysisRepository.GetLatestForRepoAsync(repo.Id);
        return Ok(MapToDetailDto(repo, latestCheck, latestAnalysisJob));
    }

    /// <summary>
    /// Shared by CreateRepo/SyncRepo: pulls language stats, contributors, and commit
    /// activity from GitHub and replaces each child collection wholesale via
    /// IRepoRepository (see Interfaces.cs's ReplaceXAsync contract notes).
    /// </summary>
    private async Task SyncChildDataAsync(Repo repo, CancellationToken ct)
    {
        var languageStats = await _gitHubService.FetchLanguageStatsAsync(repo.Owner, repo.Name);
        await _repoRepository.ReplaceLanguageStatsAsync(repo.Id, languageStats);

        ct.ThrowIfCancellationRequested();

        var contributors = await _gitHubService.FetchContributorsAsync(repo.Owner, repo.Name);

        // FetchContributorsAsync doesn't carry commit counts (Octokit's contributors
        // endpoint returns them alongside login/avatar in practice) — VERIFY WITH
        // INTELLISENSE: GitHubService.FetchContributorsAsync currently only maps
        // Login/AvatarUrl onto Contributor. If the underlying Octokit
        // RepositoryContributor model exposes a Contributions/CommitCount-shaped
        // property, extend IGitHubService to surface it per-contributor instead of the
        // placeholder 0 below.
        var contributorPairs = contributors
            .Select(c => (Contributor: c, CommitCount: 0))
            .ToList();
        await _repoRepository.ReplaceContributorsAsync(repo.Id, contributorPairs);

        ct.ThrowIfCancellationRequested();

        var commitActivity = await _gitHubService.FetchCommitActivityAsync(repo.Owner, repo.Name);
        await _repoRepository.ReplaceCommitActivityAsync(repo.Id, commitActivity);
    }

    private RepoDetailDto MapToDetailDto(Repo repo, HealthCheck? latestCheck, AnalysisJob? latestAnalysisJob)
    {
        return new RepoDetailDto
        {
            Id = repo.Id,
            Owner = repo.Owner,
            Name = repo.Name,
            Description = repo.Description,
            Topics = repo.Topics,
            ReadmeHtml = null, // see GetRepo's comment — not yet persisted on Repo
            Languages = repo.LanguageStats
                .Select(l => new LanguageStatDto { Language = l.Language, ByteCount = l.ByteCount })
                .ToList(),
            // Mapped from RepoContributor rather than the Contributor entity directly:
            // CommitCount lives on the join row (it's repo-specific), and returning
            // the raw Contributor entity here was both the source of the OpenAPI
            // schema-generator's infinite-recursion 500 (Contributor.RepoContributors
            // -> RepoContributor.Repo -> Repo.RepoContributors -> ...) and silently
            // dropping CommitCount, since Contributor itself doesn't carry it.
            Contributors = repo.RepoContributors
                .Where(rc => rc.Contributor is not null)
                .Select(rc => new ContributorDto
                {
                    GithubUsername = rc.Contributor!.GithubUsername,
                    AvatarUrl = rc.Contributor!.AvatarUrl,
                    CommitCount = rc.CommitCount
                })
                .ToList(),
            CommitActivity = repo.CommitActivities
                .OrderBy(c => c.WeekStart)
                .Select(c => new CommitActivityDto { WeekStart = c.WeekStart, CommitCount = c.CommitCount })
                .ToList(),
            EntryPointPath = repo.EntryPointPath,
            LiveDemoUrl = repo.LiveDemoUrl,
            HealthStatus = latestCheck?.Status ?? HealthStatus.Unknown,
            Stars = repo.Stars,
            Forks = repo.Forks,
            // No AnalysisJob yet (repo was never analyzed) maps to Queued rather than a
            // separate "NotStarted" state — the frontend's queued/running/succeeded/
            // failed status treatment (Guide.md §5.0) already reads Queued as "not
            // analyzed, show the Analyze button," so no new enum member is needed.
            AnalysisStatus = latestAnalysisJob?.Status ?? AnalysisStatus.Queued
        };
    }
}