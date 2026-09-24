using Microsoft.EntityFrameworkCore;
using Repogeist.Core;

namespace Repogeist.Data.Repositories;

public class HealthCheckRepository(RepogeistDbContext db) : IHealthCheckRepository
{
    public async Task AddAsync(HealthCheck check)
    {
        if (check.Id == Guid.Empty)
        {
            check.Id = Guid.NewGuid();
        }

        db.HealthChecks.Add(check);
        await db.SaveChangesAsync();
    }

    public async Task<List<HealthCheck>> GetHistoryAsync(Guid repoId)
    {
        return await db.HealthChecks
            .AsNoTracking()
            .Where(h => h.RepoId == repoId)
            .OrderByDescending(h => h.CheckedAt)
            .ToListAsync();
    }

    public async Task<HealthCheck?> GetLatestAsync(Guid repoId)
    {
        return await db.HealthChecks
            .AsNoTracking()
            .Where(h => h.RepoId == repoId)
            .OrderByDescending(h => h.CheckedAt)
            .FirstOrDefaultAsync();
    }
}