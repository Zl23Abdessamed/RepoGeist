using Microsoft.AspNetCore.SignalR;
using Repogeist.Core;
using Repogeist.Hubs;

namespace Repogeist.Jobs;

/// <summary>
/// Orchestrates the clone pipeline: create job -> mark Cloning -> reuse an existing
/// clone if one is already valid, otherwise clone -> mark Ready, with progress pushed
/// over CloneHub at each step (Guide.md §5.0, backend.md §6.6). Queued via Hangfire
/// like AnalysisJobs (TechGuide.md §2.3) — this class is registered as the Hangfire job
/// target (see Program.cs), not itself a BackgroundService.
///
/// Triggered automatically right after ReposController.CreateRepo persists the new
/// Repo — not something the user separately requests (Guide.md §5.0). This is the one
/// place a clone starts unprompted; AnalysisJobs only clones as a repair step when it
/// finds no existing valid clone.
/// </summary>
public class CloneJobs(
    IRepoRepository repoRepository,
    ICloneRepository cloneRepository,
    ICloneService cloneService,
    IHubContext<CloneHub> hubContext,
    ILogger<CloneJobs> logger)
{
    /// <summary>
    /// Runs the full clone pipeline for a repo — see the step-by-step contract in
    /// backend.md §6.6. Intended to be invoked as a Hangfire background job
    /// (BackgroundJob.Enqueue&lt;CloneJobs&gt;(j => j.RunCloneJobAsync(repoId))) from
    /// ReposController's POST /api/repos endpoint, fired immediately after the Repo
    /// itself is persisted.
    /// </summary>
    public async Task RunCloneJobAsync(Guid repoId)
    {
        // 1. Look up the repo. ReposController resolves owner/name to a Guid before
        //    enqueueing, so this job operates purely on the id — no owner/name lookup
        //    needed here. IRepoRepository doesn't currently expose a GetByIdAsync, so
        //    fall back to scanning GetAllAsync(); worth adding a dedicated method if
        //    this job's call volume ever makes that scan a real cost (same tradeoff
        //    AnalysisJobs already accepts).
        var allRepos = await repoRepository.GetAllAsync();
        var repo = allRepos.FirstOrDefault(r => r.Id == repoId);

        if (repo is null)
        {
            logger.LogWarning("CloneJobs: repo {RepoId} not found; aborting job.", repoId);
            return;
        }

        // 2. Create the job record and mark it Cloning.
        var job = await cloneRepository.CreateJobAsync(repoId);
        await cloneRepository.UpdateJobStatusAsync(job.Id, CloneStatus.Cloning);
        await BroadcastAsync(repoId, job.Id, CloneStatus.Cloning);

        try
        {
            // 3. Nothing to do if a valid clone already exists — e.g. this repo was
            //    re-ingested, or a prior clone job succeeded and this one is a retry.
            var existingPath = await cloneService.GetExistingClonePathAsync(repoId);

            if (existingPath is not null)
            {
                await cloneRepository.UpdateJobStatusAsync(job.Id, CloneStatus.Ready, existingPath);
                await BroadcastAsync(repoId, job.Id, CloneStatus.Ready);
                return;
            }

            // 4. No valid clone found — do the actual git work.
            var localPath = await cloneService.CloneAsync(repo.Owner, repo.Name);

            // 5. Mark Ready with the resulting path.
            await cloneRepository.UpdateJobStatusAsync(job.Id, CloneStatus.Ready, localPath);
            await BroadcastAsync(repoId, job.Id, CloneStatus.Ready);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "CloneJobs: job {JobId} for repo {RepoId} failed.", job.Id, repoId);
            await cloneRepository.UpdateJobStatusAsync(job.Id, CloneStatus.Failed, errorMessage: ex.Message);
            await BroadcastAsync(repoId, job.Id, CloneStatus.Failed, ex.Message);
        }
    }

    private async Task BroadcastAsync(Guid repoId, Guid jobId, CloneStatus status, string? errorMessage = null)
    {
        var dto = new CloneStatusDto
        {
            RepoId = repoId,
            JobId = jobId,
            Status = status.ToString(),
            ErrorMessage = errorMessage
        };

        await hubContext.BroadcastCloneUpdateAsync(dto);
    }
}