using Microsoft.EntityFrameworkCore;
using Repogeist.Core;

namespace Repogeist.Data;

public class RepogeistDbContext(DbContextOptions<RepogeistDbContext> options) : DbContext(options)
{
    public DbSet<Repo> Repos => Set<Repo>();
    public DbSet<LanguageStat> LanguageStats => Set<LanguageStat>();
    public DbSet<Contributor> Contributors => Set<Contributor>();
    public DbSet<RepoContributor> RepoContributors => Set<RepoContributor>();
    public DbSet<HealthCheck> HealthChecks => Set<HealthCheck>();
    public DbSet<CommitActivity> CommitActivities => Set<CommitActivity>();
    public DbSet<CloneJob> CloneJobs => Set<CloneJob>();
    public DbSet<AnalysisJob> AnalysisJobs => Set<AnalysisJob>();
    public DbSet<GraphNode> GraphNodes => Set<GraphNode>();
    public DbSet<GraphEdge> GraphEdges => Set<GraphEdge>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // ── Repo ───────────────────────────────────────────────
        modelBuilder.Entity<Repo>(entity =>
        {
            entity.ToTable("Repos");
            entity.HasKey(r => r.Id);

            entity.Property(r => r.Owner).IsRequired();
            entity.Property(r => r.Name).IsRequired();

            // Owner+Name uniquely identifies a repo and is the lookup key used by
            // GetByOwnerAndNameAsync and every /api/repos/{owner}/{name} route.
            entity.HasIndex(r => new { r.Owner, r.Name }).IsUnique();

            // Topics is a simple string list — stored as a Postgres text[] via a value
            // comparer so EF can detect in-place mutations correctly.
            entity.Property(r => r.Topics)
                .HasColumnType("text[]")
                .Metadata.SetValueComparer(new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<List<string>>(
                    (a, b) => (a ?? new()).SequenceEqual(b ?? new()),
                    v => v.Aggregate(0, (hash, s) => HashCode.Combine(hash, s.GetHashCode())),
                    v => v.ToList()));

            // Cached computed dependency graph — JSONB per backend.md/TechGuide.md 3.2
            entity.Property(r => r.DependencyGraphJson).HasColumnType("jsonb");
        });

        // ── LanguageStat ───────────────────────────────────────
        modelBuilder.Entity<LanguageStat>(entity =>
        {
            entity.ToTable("LanguageStats");
            entity.HasKey(l => l.Id);
            entity.Property(l => l.Language).IsRequired();

            entity.HasOne(l => l.Repo)
                .WithMany(r => r.LanguageStats)
                .HasForeignKey(l => l.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(l => l.RepoId);
        });

        // ── Contributor ────────────────────────────────────────
        modelBuilder.Entity<Contributor>(entity =>
        {
            entity.ToTable("Contributors");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.GithubUsername).IsRequired();

            // Contributor rows are shared across repos; GithubUsername is the natural
            // key ReplaceContributorsAsync upserts against (see backend.md 6.3/6.6).
            entity.HasIndex(c => c.GithubUsername).IsUnique();
        });

        // ── RepoContributor (join table) ────────────────────────
        modelBuilder.Entity<RepoContributor>(entity =>
        {
            entity.ToTable("RepoContributors");
            entity.HasKey(rc => rc.Id);

            entity.HasOne(rc => rc.Repo)
                .WithMany(r => r.RepoContributors)
                .HasForeignKey(rc => rc.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(rc => rc.Contributor)
                .WithMany(c => c.RepoContributors)
                .HasForeignKey(rc => rc.ContributorId)
                .OnDelete(DeleteBehavior.Cascade);

            // A given contributor should only appear once per repo.
            entity.HasIndex(rc => new { rc.RepoId, rc.ContributorId }).IsUnique();
        });

        // ── HealthCheck ────────────────────────────────────────
        modelBuilder.Entity<HealthCheck>(entity =>
        {
            entity.ToTable("HealthChecks");
            entity.HasKey(h => h.Id);
            entity.Property(h => h.Status).HasConversion<string>();

            entity.HasOne(h => h.Repo)
                .WithMany(r => r.HealthChecks)
                .HasForeignKey(h => h.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            // GetHistoryAsync / GetLatestAsync both query by repo, ordered by CheckedAt.
            entity.HasIndex(h => new { h.RepoId, h.CheckedAt });
        });

        // ── CommitActivity ───────────────────────────────────────
        modelBuilder.Entity<CommitActivity>(entity =>
        {
            entity.ToTable("CommitActivities");
            entity.HasKey(c => c.Id);

            entity.HasOne(c => c.Repo)
                .WithMany(r => r.CommitActivities)
                .HasForeignKey(c => c.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(c => new { c.RepoId, c.WeekStart }).IsUnique();
        });

        // ── CloneJob ─────────────────────────────────────────────
        modelBuilder.Entity<CloneJob>(entity =>
        {
            entity.ToTable("CloneJobs");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Status).HasConversion<string>();

            entity.HasOne(c => c.Repo)
                .WithMany(r => r.CloneJobs)
                .HasForeignKey(c => c.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            // GetLatestForRepoAsync queries by repo, ordered by most recent —
            // StartedAt is nullable (a Queued job may not have started yet), so order
            // by Id/CreatedAt-equivalent isn't available; the repository orders by
            // StartedAt descending with Id as a tiebreaker (see CloneRepository).
            entity.HasIndex(c => new { c.RepoId, c.StartedAt });
        });

        // ── AnalysisJob ────────────────────────────────────────
        modelBuilder.Entity<AnalysisJob>(entity =>
        {
            entity.ToTable("AnalysisJobs");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Status).HasConversion<string>();

            entity.HasOne(a => a.Repo)
                .WithMany(r => r.AnalysisJobs)
                .HasForeignKey(a => a.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(a => a.RepoId);
        });

        // ── GraphNode ────────────────────────────────────────────
        modelBuilder.Entity<GraphNode>(entity =>
        {
            entity.ToTable("GraphNodes");
            entity.HasKey(g => g.Id);
            entity.Property(g => g.NodeType).HasConversion<string>();
            entity.Property(g => g.PathOrName).IsRequired();

            entity.HasOne(g => g.Repo)
                .WithMany(r => r.GraphNodes)
                .HasForeignKey(g => g.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(g => g.RepoId);
        });

        // ── GraphEdge ────────────────────────────────────────────
        modelBuilder.Entity<GraphEdge>(entity =>
        {
            entity.ToTable("GraphEdges");
            entity.HasKey(g => g.Id);
            entity.Property(g => g.EdgeType).HasConversion<string>();

            entity.HasOne(g => g.Repo)
                .WithMany(r => r.GraphEdges)
                .HasForeignKey(g => g.RepoId)
                .OnDelete(DeleteBehavior.Cascade);

            // SourceNode/TargetNode both FK into GraphNodes. Cascading both would give
            // SQL Server multiple-cascade-path errors; Postgres allows it, but Restrict
            // here is still correct since deleting a Repo cascades edges via RepoId
            // above — deleting a single GraphNode should not silently cascade-delete
            // edges through this second path.
            entity.HasOne(g => g.SourceNode)
                .WithMany()
                .HasForeignKey(g => g.SourceNodeId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(g => g.TargetNode)
                .WithMany()
                .HasForeignKey(g => g.TargetNodeId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(g => g.RepoId);
            entity.HasIndex(g => g.SourceNodeId);
            entity.HasIndex(g => g.TargetNodeId);
        });
    }
}