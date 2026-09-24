namespace Repogeist.Core;

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

public enum HealthStatus
{
    Up,
    Down,
    Unknown
}

public enum CloneStatus
{
    Queued,
    Cloning,
    Ready,
    Failed
}

public enum AnalysisStatus
{
    Queued,
    Running,
    Succeeded,
    Failed
}

public enum NodeType
{
    File,
    Function
}

public enum EdgeType
{
    Imports,
    Calls
}

// ─────────────────────────────────────────────────────────────
// Tier 1 entities
// ─────────────────────────────────────────────────────────────

public class Repo
{
    public Guid Id { get; set; }
    public string Owner { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public List<string> Topics { get; set; } = [];
    public string? PrimaryLanguage { get; set; }
    public int Stars { get; set; }
    public int Forks { get; set; }
    public string? LiveDemoUrl { get; set; }
    public string? EntryPointPath { get; set; }

    // Tier 2: cached computed dependency graph (JSONB column)
    public string? DependencyGraphJson { get; set; }

    public DateTime LastSyncedAt { get; set; }

    // Navigation
    public List<LanguageStat> LanguageStats { get; set; } = [];
    public List<RepoContributor> RepoContributors { get; set; } = [];
    public List<HealthCheck> HealthChecks { get; set; } = [];
    public List<CommitActivity> CommitActivities { get; set; } = [];
    public List<CloneJob> CloneJobs { get; set; } = [];
    public List<AnalysisJob> AnalysisJobs { get; set; } = [];
    public List<GraphNode> GraphNodes { get; set; } = [];
    public List<GraphEdge> GraphEdges { get; set; } = [];
}

public class LanguageStat
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }
    public string Language { get; set; } = string.Empty;
    public long ByteCount { get; set; }

    // Navigation
    public Repo? Repo { get; set; }
}

public class Contributor
{
    public Guid Id { get; set; }
    public string GithubUsername { get; set; } = string.Empty;
    public string AvatarUrl { get; set; } = string.Empty;

    // Navigation
    public List<RepoContributor> RepoContributors { get; set; } = [];
}

public class RepoContributor
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }
    public Guid ContributorId { get; set; }
    public int CommitCount { get; set; }

    // Navigation
    public Repo? Repo { get; set; }
    public Contributor? Contributor { get; set; }
}

public class HealthCheck
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }
    public DateTime CheckedAt { get; set; }
    public HealthStatus Status { get; set; }
    public int? ResponseTimeMs { get; set; }

    // Navigation
    public Repo? Repo { get; set; }
}

public class CommitActivity
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }

    // Start of the week this count covers (UTC, Monday)
    public DateTime WeekStart { get; set; }
    public int CommitCount { get; set; }

    // Navigation
    public Repo? Repo { get; set; }
}

// ─────────────────────────────────────────────────────────────
// Tier 1.5 entities — cloning (decoupled from analysis, Guide.md §5.0)
// ─────────────────────────────────────────────────────────────

public class CloneJob
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }
    public CloneStatus Status { get; set; }

    // Filesystem path to the shallow clone once Ready
    public string? LocalPath { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? ErrorMessage { get; set; }

    // Navigation
    public Repo? Repo { get; set; }
}

// ─────────────────────────────────────────────────────────────
// Tier 2 entities
// ─────────────────────────────────────────────────────────────

public class AnalysisJob
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }
    public AnalysisStatus Status { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? ErrorMessage { get; set; }

    // Navigation
    public Repo? Repo { get; set; }
}

public class GraphNode
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }
    public NodeType NodeType { get; set; }
    public string PathOrName { get; set; } = string.Empty;

    // Navigation
    public Repo? Repo { get; set; }
}

public class GraphEdge
{
    public Guid Id { get; set; }
    public Guid RepoId { get; set; }
    public Guid SourceNodeId { get; set; }
    public Guid TargetNodeId { get; set; }
    public EdgeType EdgeType { get; set; }

    // Navigation
    public Repo? Repo { get; set; }
    public GraphNode? SourceNode { get; set; }
    public GraphNode? TargetNode { get; set; }
}