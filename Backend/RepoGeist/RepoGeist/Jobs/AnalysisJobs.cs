using Microsoft.AspNetCore.SignalR;
using Repogeist.Core;
using Repogeist.Hubs;

namespace Repogeist.Jobs;

/// <summary>
/// Orchestrates the Tier 2 static-analysis pipeline: verify/repair clone -> resolve
/// analyzer -> parse -> save graph -> report status, with progress pushed over
/// AnalysisHub at each step (Guide.md §5.1, backend.md §6.6). Queued via Hangfire
/// rather than a bare BackgroundService, since analysis is a heavier, potentially
/// slow, retry-worthy job (TechGuide.md §2.3) — this class is registered as the
/// Hangfire job target (see Program.cs), not itself a BackgroundService.
///
/// Analysis never assumes a clone exists — it checks first via ICloneService and only
/// clones as a repair step if the check comes back empty (Guide.md §5.0). This makes
/// analysis robust to the automatic CloneJobs run having failed, been cleaned up, or
/// never finished, without the caller needing to know or care which case applies.
/// </summary>
public class AnalysisJobs(
    IRepoRepository repoRepository,
    IAnalysisRepository analysisRepository,
    ICloneService cloneService,
    IAnalyzerResolver analyzerResolver,
    IHubContext<AnalysisHub> hubContext,
    ILogger<AnalysisJobs> logger)
{
    /// <summary>
    /// Runs the full analysis pipeline for a repo — see the step-by-step contract in
    /// backend.md §6.6. Intended to be invoked as a Hangfire background job
    /// (BackgroundJob.Enqueue&lt;AnalysisJobs&gt;(j => j.RunAnalysisJobAsync(repoId))) from
    /// AnalysisController's POST /api/repos/{owner}/{name}/analyze endpoint.
    /// </summary>
    public async Task RunAnalysisJobAsync(Guid repoId)
    {
        // 1. Look up the repo. AnalysisController resolves owner/name to a Guid before
        //    enqueueing, so this job operates purely on the id — no owner/name lookup
        //    needed here. IRepoRepository doesn't currently expose a GetByIdAsync, so
        //    fall back to scanning GetAllAsync(); worth adding a dedicated method if
        //    this job's call volume ever makes that scan a real cost.
        var allRepos = await repoRepository.GetAllAsync();
        var repo = allRepos.FirstOrDefault(r => r.Id == repoId);

        if (repo is null)
        {
            logger.LogWarning("AnalysisJobs: repo {RepoId} not found; aborting job.", repoId);
            return;
        }

        // 2. Create the job record and mark it Running.
        var job = await analysisRepository.CreateJobAsync(repoId);
        await analysisRepository.UpdateJobStatusAsync(job.Id, AnalysisStatus.Running);
        await BroadcastAsync(repoId, job.Id, AnalysisStatus.Running);

        try
        {
            // 3. Check for an existing, valid clone first; only clone if none is found.
            //    This is the "analysis checks for the clone first, rather than
            //    assuming it" rule (Guide.md §5.0) — the resulting path is durable and
            //    shared (CloneService, not a per-job temp dir), so later jobs and the
            //    Code view can reuse it too.
            var repoPath = await cloneService.GetExistingClonePathAsync(repoId)
                ?? await cloneService.CloneAsync(repo.Owner, repo.Name);

            // 4. Resolve the analyzer for this repo's primary language.
            var analyzer = repo.PrimaryLanguage is null
                ? null
                : analyzerResolver.Resolve(repo.PrimaryLanguage);

            if (analyzer is null)
            {
                await analysisRepository.UpdateJobStatusAsync(
                    job.Id, AnalysisStatus.Failed, "Unsupported language");
                await BroadcastAsync(repoId, job.Id, AnalysisStatus.Failed, "Unsupported language");
                return;
            }

            // 5. Parse and build the dependency graph.
            var graph = await analyzer.AnalyzeAsync(repoPath);
            graph.RepoId = repoId;

            // 6. Persist the graph (normalized tables + JSONB cache).
            await analysisRepository.SaveGraphAsync(repoId, graph);

            // 7. Mark succeeded.
            await analysisRepository.UpdateJobStatusAsync(job.Id, AnalysisStatus.Succeeded);
            await BroadcastAsync(repoId, job.Id, AnalysisStatus.Succeeded);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "AnalysisJobs: job {JobId} for repo {RepoId} failed.", job.Id, repoId);
            await analysisRepository.UpdateJobStatusAsync(job.Id, AnalysisStatus.Failed, ex.Message);
            await BroadcastAsync(repoId, job.Id, AnalysisStatus.Failed, ex.Message);
        }

        // No finally-block cleanup here anymore: the clone lives under CloneService's
        // durable root and is intentionally kept around for reuse (by a later analysis
        // run, or by the Code view reading files directly from it) rather than deleted
        // per job the way the old inline-temp-dir version did.
    }

    private async Task BroadcastAsync(Guid repoId, Guid jobId, AnalysisStatus status, string? errorMessage = null)
    {
        var dto = new AnalysisStatusDto
        {
            RepoId = repoId,
            JobId = jobId,
            Status = status.ToString(),
            ErrorMessage = errorMessage
        };

        await hubContext.BroadcastAnalysisUpdateAsync(dto);
    }
}