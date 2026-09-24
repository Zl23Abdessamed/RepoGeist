using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Repogeist.Core;

namespace Repogeist.Data.Repositories;

public class AnalysisRepository(RepogeistDbContext db) : IAnalysisRepository
{
    public async Task<AnalysisJob> CreateJobAsync(Guid repoId)
    {
        var job = new AnalysisJob
        {
            Id = Guid.NewGuid(),
            RepoId = repoId,
            Status = AnalysisStatus.Queued
        };

        db.AnalysisJobs.Add(job);
        await db.SaveChangesAsync();

        return job;
    }

    public async Task<AnalysisJob?> GetJobAsync(Guid jobId)
    {
        return await db.AnalysisJobs
            .AsNoTracking()
            .FirstOrDefaultAsync(j => j.Id == jobId);
    }

    public async Task<AnalysisJob?> GetLatestForRepoAsync(Guid repoId)
    {
        // Drives RepoDetailDto.AnalysisStatus / the SidePanel "Analyze" vs. "Analyzed"
        // treatment (backend.md 6.4). StartedAt is nullable for a still-Queued job, so
        // order by CompletedAt/StartedAt with Id as a tiebreaker rather than assuming
        // either timestamp is always set.
        return await db.AnalysisJobs
            .AsNoTracking()
            .Where(j => j.RepoId == repoId)
            .OrderByDescending(j => j.CompletedAt)
            .ThenByDescending(j => j.StartedAt)
            .ThenByDescending(j => j.Id)
            .FirstOrDefaultAsync();
    }

    public async Task UpdateJobStatusAsync(Guid jobId, AnalysisStatus status, string? errorMessage = null)
    {
        var job = await db.AnalysisJobs.FirstOrDefaultAsync(j => j.Id == jobId)
            ?? throw new InvalidOperationException($"AnalysisJob {jobId} not found.");

        job.Status = status;
        job.ErrorMessage = errorMessage;

        if (status == AnalysisStatus.Running && job.StartedAt is null)
        {
            job.StartedAt = DateTime.UtcNow;
        }

        if (status is AnalysisStatus.Succeeded or AnalysisStatus.Failed)
        {
            job.CompletedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
    }

    public async Task SaveGraphAsync(Guid repoId, DependencyGraphDto graph)
    {
        // Replace this repo's normalized GraphNodes/GraphEdges wholesale — the graph is
        // fully recomputed on each analysis run, so there's nothing to diff against.
        var existingEdges = await db.GraphEdges.Where(e => e.RepoId == repoId).ToListAsync();
        db.GraphEdges.RemoveRange(existingEdges);

        var existingNodes = await db.GraphNodes.Where(n => n.RepoId == repoId).ToListAsync();
        db.GraphNodes.RemoveRange(existingNodes);

        // Flush the deletes before inserting so the GraphEdge FK checks against
        // SourceNode/TargetNode (Restrict delete behavior — see DbContext) don't
        // collide with the new node rows sharing the same ids in a single unit of work.
        await db.SaveChangesAsync();

        var newNodes = graph.Nodes.Select(n => new GraphNode
        {
            Id = n.Id == Guid.Empty ? Guid.NewGuid() : n.Id,
            RepoId = repoId,
            NodeType = Enum.Parse<NodeType>(n.NodeType, ignoreCase: true),
            PathOrName = n.PathOrName
        }).ToList();
        await db.GraphNodes.AddRangeAsync(newNodes);

        var newEdges = graph.Edges.Select(e => new GraphEdge
        {
            Id = Guid.NewGuid(),
            RepoId = repoId,
            SourceNodeId = e.SourceNodeId,
            TargetNodeId = e.TargetNodeId,
            EdgeType = Enum.Parse<EdgeType>(e.EdgeType, ignoreCase: true)
        }).ToList();
        await db.GraphEdges.AddRangeAsync(newEdges);

        // Cache the full computed graph as JSONB on the Repo row too, so "just show me
        // the graph" reads (GetGraphAsync) are a single fast lookup rather than a join
        // across GraphNodes/GraphEdges — see TechGuide.md 3.2.
        var repo = await db.Repos.FirstOrDefaultAsync(r => r.Id == repoId)
            ?? throw new InvalidOperationException($"Repo {repoId} not found.");
        repo.DependencyGraphJson = JsonSerializer.Serialize(graph);

        await db.SaveChangesAsync();
    }

    public async Task<DependencyGraphDto?> GetGraphAsync(Guid repoId)
    {
        // Reads from the Repo.DependencyGraphJson cache, not the normalized tables —
        // see backend.md 6.6.
        var json = await db.Repos
            .AsNoTracking()
            .Where(r => r.Id == repoId)
            .Select(r => r.DependencyGraphJson)
            .FirstOrDefaultAsync();

        return json is null ? null : JsonSerializer.Deserialize<DependencyGraphDto>(json);
    }
}