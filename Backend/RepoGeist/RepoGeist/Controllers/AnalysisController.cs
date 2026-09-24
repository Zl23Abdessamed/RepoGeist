using Hangfire;
using Microsoft.AspNetCore.Mvc;
using Repogeist.Core;
using Repogeist.Jobs;

namespace Repogeist.Controllers;

/// <summary>
/// Tier 2 endpoints — kicking off analysis jobs and reading their results (Guide.md
/// §5, backend.md §3/§6.4). Clone-status/file/file-tree concerns live in
/// CloneController, not here — Code is a separate, clone-only pipeline that doesn't
/// depend on anything in this controller (Guide.md §5.0/§5.2).
///
/// StartAnalysis now enqueues the real Repogeist.Jobs.AnalysisJobs pipeline via
/// Hangfire. AnalysisJobs itself checks for an existing clone via ICloneService before
/// doing any git work, and only clones as a repair step if none is found — it never
/// assumes the automatic ingestion-time CloneJobs run has already produced one
/// (Guide.md §5.0).
/// </summary>
[ApiController]
[Route("api/repos/{owner}/{name}")]
public class AnalysisController : ControllerBase
{
    private readonly IRepoRepository _repoRepository;
    private readonly IAnalysisRepository _analysisRepository;
    private readonly IBackgroundJobClient _backgroundJobClient;
    private readonly ILogger<AnalysisController> _logger;

    public AnalysisController(
        IRepoRepository repoRepository,
        IAnalysisRepository analysisRepository,
        IBackgroundJobClient backgroundJobClient,
        ILogger<AnalysisController> logger)
    {
        _repoRepository = repoRepository;
        _analysisRepository = analysisRepository;
        _backgroundJobClient = backgroundJobClient;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/repos/{owner}/{name}/analyze — enqueues Repogeist.Jobs.AnalysisJobs
    /// via Hangfire and returns immediately (202 Accepted); the frontend then
    /// subscribes to /hub/analysis for push updates (TechGuide.md §2.7) rather than
    /// polling this endpoint again.
    ///
    /// The job itself creates its own AnalysisJob row (see AnalysisJobs.RunAnalysisJobAsync
    /// step 2) — this endpoint only enqueues; it deliberately doesn't create a Queued
    /// row up front, since that would leave a second, orphaned row if the enqueue
    /// itself succeeds but the job hasn't started (there is exactly one AnalysisJob
    /// row per run, created by the job, not by the controller).
    /// </summary>
    [HttpPost("analyze")]
    public async Task<ActionResult<AnalysisStatusDto>> StartAnalysis(string owner, string name)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        _logger.LogInformation(
            "AnalysisController: enqueueing analysis for {Owner}/{Name} ({RepoId}).",
            owner, name, repo.Id);

        _backgroundJobClient.Enqueue<AnalysisJobs>(j => j.RunAnalysisJobAsync(repo.Id));

        var dto = new AnalysisStatusDto
        {
            RepoId = repo.Id,
            JobId = Guid.Empty, // not yet known — AnalysisJobs creates the real job row; the
                                // frontend gets the actual JobId from the first /hub/analysis push
            Status = AnalysisStatus.Queued.ToString(),
            ProgressPercent = null,
            ErrorMessage = null
        };

        return Accepted(dto);
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name}/analysis-status — whether this repo has a
    /// completed (or in-progress) analysis, backing RepoDetailDto.AnalysisStatus / the
    /// SidePanel Overview "Analyze" vs. "Analyzed" treatment (Guide.md §5.0). Fetched
    /// once on load; kept live afterward via /hub/analysis rather than re-polled
    /// (TechGuide.md §2.7).
    /// </summary>
    [HttpGet("analysis-status")]
    [ProducesResponseType(typeof(AnalysisStatusDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AnalysisStatusDto>> GetAnalysisStatus(string owner, string name)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        var latestJob = await _analysisRepository.GetLatestForRepoAsync(repo.Id);

        // No AnalysisJob yet reads as Queued/"not analyzed" — same convention as
        // ReposController.MapToDetailDto's AnalysisStatus mapping.
        var dto = new AnalysisStatusDto
        {
            RepoId = repo.Id,
            JobId = latestJob?.Id ?? Guid.Empty,
            Status = (latestJob?.Status ?? AnalysisStatus.Queued).ToString(),
            ProgressPercent = null,
            ErrorMessage = latestJob?.ErrorMessage
        };

        return Ok(dto);
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name}/graph — the cached computed dependency graph
    /// (IAnalysisRepository.GetGraphAsync reads Repo.DependencyGraphJson, not the
    /// normalized tables — see AnalysisRepository.cs). Returns 404 if no analysis has
    /// ever completed for this repo.
    /// </summary>
    [HttpGet("graph")]
    [ProducesResponseType(typeof(DependencyGraphDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<DependencyGraphDto>> GetGraph(string owner, string name)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        var graph = await _analysisRepository.GetGraphAsync(repo.Id);
        if (graph is null)
        {
            return NotFound($"No analysis graph is available for {owner}/{name} yet.");
        }

        return Ok(graph);
    }
}