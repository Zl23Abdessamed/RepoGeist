using Microsoft.EntityFrameworkCore;
using Repogeist.Core;

namespace Repogeist.Data.Repositories;

public class CloneRepository(RepogeistDbContext db) : ICloneRepository
{
    public async Task<CloneJob> CreateJobAsync(Guid repoId)
    {
        var job = new CloneJob
        {
            Id = Guid.NewGuid(),
            RepoId = repoId,
            Status = CloneStatus.Queued
        };

        db.CloneJobs.Add(job);
        await db.SaveChangesAsync();

        return job;
    }

    public async Task<CloneJob?> GetJobAsync(Guid jobId)
    {
        return await db.CloneJobs
            .AsNoTracking()
            .FirstOrDefaultAsync(j => j.Id == jobId);
    }

    public async Task<CloneJob?> GetLatestForRepoAsync(Guid repoId)
    {
        // This is what ICloneService.GetExistingClonePathAsync reads from to decide
        // whether a valid clone already exists (Guide.md §5.0's "check before
        // re-cloning" rule) — same ordering rationale as
        // AnalysisRepository.GetLatestForRepoAsync: StartedAt is nullable for a
        // still-Queued job, so fall back through CompletedAt/StartedAt/Id.
        return await db.CloneJobs
            .AsNoTracking()
            .Where(j => j.RepoId == repoId)
            .OrderByDescending(j => j.CompletedAt)
            .ThenByDescending(j => j.StartedAt)
            .ThenByDescending(j => j.Id)
            .FirstOrDefaultAsync();
    }

    public async Task UpdateJobStatusAsync(Guid jobId, CloneStatus status, string? localPath = null, string? errorMessage = null)
    {
        var job = await db.CloneJobs.FirstOrDefaultAsync(j => j.Id == jobId)
            ?? throw new InvalidOperationException($"CloneJob {jobId} not found.");

        job.Status = status;
        job.ErrorMessage = errorMessage;

        if (localPath is not null)
        {
            job.LocalPath = localPath;
        }

        if (status == CloneStatus.Cloning && job.StartedAt is null)
        {
            job.StartedAt = DateTime.UtcNow;
        }

        if (status is CloneStatus.Ready or CloneStatus.Failed)
        {
            job.CompletedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
    }
}