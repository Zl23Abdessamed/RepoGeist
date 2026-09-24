using Microsoft.AspNetCore.Mvc;
using Repogeist.Core;

namespace Repogeist.Controllers;

/// <summary>
/// Tier 1 read endpoints for a repo's health-check history and commit activity
/// (backend.md §3/§6.4). Live status *changes* are pushed over HealthHub
/// (TechGuide.md §2.7) — this controller only serves historical/on-demand reads;
/// there is no polling endpoint for "current" status by design.
/// </summary>
[ApiController]
[Route("api/repos/{owner}/{name}")]
public class HealthController : ControllerBase
{
    private const int DefaultHealthHistoryLimit = 100;
    private const int DefaultCommitActivityWeeks = 52;

    private readonly IRepoRepository _repoRepository;
    private readonly IHealthCheckRepository _healthCheckRepository;

    public HealthController(
        IRepoRepository repoRepository,
        IHealthCheckRepository healthCheckRepository)
    {
        _repoRepository = repoRepository;
        _healthCheckRepository = healthCheckRepository;
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name}/health — historical health checks, most recent
    /// first, capped to `limit` (default 100). Backs the Level 2 panel's health
    /// history / response-time trend (Guide.md §4.5).
    /// </summary>
    [HttpGet("health")]
    public async Task<ActionResult<HealthStatusDto[]>> GetHealthHistory(
        string owner,
        string name,
        [FromQuery] int? limit = DefaultHealthHistoryLimit)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        var effectiveLimit = limit is > 0 ? limit.Value : DefaultHealthHistoryLimit;

        // IHealthCheckRepository.GetHistoryAsync already returns newest-first (see
        // HealthCheckRepository's OrderByDescending(CheckedAt)) — just cap here.
        var history = await _healthCheckRepository.GetHistoryAsync(repo.Id);

        var dtos = history
            .Take(effectiveLimit)
            .Select(h => new HealthStatusDto
            {
                RepoId = h.RepoId,
                Status = h.Status,
                ResponseTimeMs = h.ResponseTimeMs,
                CheckedAt = h.CheckedAt
            })
            .ToArray();

        return Ok(dtos);
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name}/commit-activity — weekly commit counts, oldest
    /// first, limited to the most recent `weeks` (default 52). This is GitHub-sourced
    /// data synced onto the Repo via ReposController's create/sync flow
    /// (IGitHubService.FetchCommitActivityAsync), not computed here.
    /// </summary>
    [HttpGet("commit-activity")]
    public async Task<ActionResult<CommitActivityDto[]>> GetCommitActivity(
        string owner,
        string name,
        [FromQuery] int? weeks = DefaultCommitActivityWeeks)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        var effectiveWeeks = weeks is > 0 ? weeks.Value : DefaultCommitActivityWeeks;

        var dtos = repo.CommitActivities
            .OrderByDescending(c => c.WeekStart)
            .Take(effectiveWeeks)
            .OrderBy(c => c.WeekStart)
            .Select(c => new CommitActivityDto
            {
                WeekStart = c.WeekStart,
                CommitCount = c.CommitCount
            })
            .ToArray();

        return Ok(dtos);
    }
}