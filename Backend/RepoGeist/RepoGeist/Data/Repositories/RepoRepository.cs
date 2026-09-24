using Microsoft.EntityFrameworkCore;
using Repogeist.Core;

namespace Repogeist.Data.Repositories;

public class RepoRepository(RepogeistDbContext db) : IRepoRepository
{
    public async Task<Repo?> GetByOwnerAndNameAsync(string owner, string name)
    {
        return await db.Repos
            .Include(r => r.LanguageStats)
            .Include(r => r.RepoContributors)
                .ThenInclude(rc => rc.Contributor)
            .Include(r => r.CommitActivities)
            .Include(r => r.HealthChecks)
            .FirstOrDefaultAsync(r =>
                r.Owner.ToLower() == owner.ToLower() &&
                r.Name.ToLower() == name.ToLower());
    }

    public async Task<List<Repo>> GetAllAsync()
    {
        // Card list only needs top-level Repo fields (see RepoCardDto) plus the latest
        // health status, which HealthCheckWorker/HealthController resolve separately —
        // no need to eager-load every child collection here.
        return await db.Repos.AsNoTracking().ToListAsync();
    }

    public async Task AddAsync(Repo repo)
    {
        db.Repos.Add(repo);
        await db.SaveChangesAsync();
    }

    public async Task UpdateAsync(Repo repo)
    {
        db.Repos.Update(repo);
        await db.SaveChangesAsync();
    }

    public async Task ReplaceLanguageStatsAsync(Guid repoId, List<LanguageStat> stats)
    {
        var existing = await db.LanguageStats
            .Where(l => l.RepoId == repoId)
            .ToListAsync();

        db.LanguageStats.RemoveRange(existing);

        foreach (var stat in stats)
        {
            stat.Id = stat.Id == Guid.Empty ? Guid.NewGuid() : stat.Id;
            stat.RepoId = repoId;
        }

        await db.LanguageStats.AddRangeAsync(stats);
        await db.SaveChangesAsync();
    }

    public async Task ReplaceContributorsAsync(Guid repoId, List<(Contributor Contributor, int CommitCount)> contributors)
    {
        // Upsert each Contributor by GithubUsername (unique index — see DbContext),
        // since Contributor rows are shared across repos rather than owned by one.
        var usernames = contributors.Select(p => p.Contributor.GithubUsername).ToList();

        var existingContributors = await db.Contributors
            .Where(c => usernames.Contains(c.GithubUsername))
            .ToDictionaryAsync(c => c.GithubUsername);

        var resolvedIds = new List<(Guid ContributorId, int CommitCount)>();

        foreach (var (contributor, commitCount) in contributors)
        {
            if (existingContributors.TryGetValue(contributor.GithubUsername, out var existing))
            {
                // Refresh avatar URL in case it changed on GitHub's side.
                existing.AvatarUrl = contributor.AvatarUrl;
                resolvedIds.Add((existing.Id, commitCount));
            }
            else
            {
                var newContributor = new Contributor
                {
                    Id = Guid.NewGuid(),
                    GithubUsername = contributor.GithubUsername,
                    AvatarUrl = contributor.AvatarUrl
                };
                db.Contributors.Add(newContributor);
                resolvedIds.Add((newContributor.Id, commitCount));
            }
        }

        // Replace this repo's join rows wholesale — GitHub's contributor list is the
        // source of truth and diffing individual rows isn't worth it at this scale.
        var existingJoins = await db.RepoContributors
            .Where(rc => rc.RepoId == repoId)
            .ToListAsync();
        db.RepoContributors.RemoveRange(existingJoins);

        var newJoins = resolvedIds.Select(r => new RepoContributor
        {
            Id = Guid.NewGuid(),
            RepoId = repoId,
            ContributorId = r.ContributorId,
            CommitCount = r.CommitCount
        });
        await db.RepoContributors.AddRangeAsync(newJoins);

        await db.SaveChangesAsync();
    }

    public async Task ReplaceCommitActivityAsync(Guid repoId, List<CommitActivityDto> activity)
    {
        var existing = await db.CommitActivities
            .Where(c => c.RepoId == repoId)
            .ToListAsync();

        db.CommitActivities.RemoveRange(existing);

        var entities = activity.Select(a => new CommitActivity
        {
            Id = Guid.NewGuid(),
            RepoId = repoId,
            WeekStart = a.WeekStart,
            CommitCount = a.CommitCount
        });
        await db.CommitActivities.AddRangeAsync(entities);

        await db.SaveChangesAsync();
    }
}