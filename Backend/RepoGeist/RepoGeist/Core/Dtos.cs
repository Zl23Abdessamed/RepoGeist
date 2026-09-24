namespace Repogeist.Core;

public class RepoCardDto
{
    public Guid Id { get; set; }
    public string Owner { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public List<string> Topics { get; set; } = [];
    public string? PrimaryLanguage { get; set; }
    public string? LiveDemoUrl { get; set; }
    public HealthStatus HealthStatus { get; set; }
}

public class LanguageStatDto
{
    public string Language { get; set; } = string.Empty;
    public long ByteCount { get; set; }
}

public class ContributorDto
{
    public string GithubUsername { get; set; } = string.Empty;
    public string AvatarUrl { get; set; } = string.Empty;
    public int CommitCount { get; set; }
}

public class RepoDetailDto
{
    public Guid Id { get; set; }
    public string Owner { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public List<string> Topics { get; set; } = [];
    public string? ReadmeHtml { get; set; }
    public List<LanguageStatDto> Languages { get; set; } = [];
    public List<ContributorDto> Contributors { get; set; } = [];
    public List<CommitActivityDto> CommitActivity { get; set; } = [];
    public string? EntryPointPath { get; set; }
    public string? LiveDemoUrl { get; set; }
    public HealthStatus HealthStatus { get; set; }
    public int Stars { get; set; }
    public int Forks { get; set; }

    // Drives SidePanel Overview's "Analyze" button vs. "Analyzed" status — independent
    // of CloneStatus; Code does not depend on this field (Guide.md §5.0)
    public AnalysisStatus AnalysisStatus { get; set; }
}

public class DependencyGraphDto
{
    public Guid RepoId { get; set; }
    public List<GraphNodeDto> Nodes { get; set; } = [];
    public List<GraphEdgeDto> Edges { get; set; } = [];
}

public class GraphNodeDto
{
    public Guid Id { get; set; }
    public string NodeType { get; set; } = string.Empty;
    public string PathOrName { get; set; } = string.Empty;
}

public class GraphEdgeDto
{
    public Guid SourceNodeId { get; set; }
    public Guid TargetNodeId { get; set; }
    public string EdgeType { get; set; } = string.Empty;
}

public class AnalysisStatusDto
{
    public Guid RepoId { get; set; }
    public Guid JobId { get; set; }
    public string Status { get; set; } = string.Empty;
    public int? ProgressPercent { get; set; }
    public string? ErrorMessage { get; set; }
}

public class CloneStatusDto
{
    public Guid RepoId { get; set; }
    public Guid JobId { get; set; }

    // Queued | Cloning | Ready | Failed
    public string Status { get; set; } = string.Empty;
    public int? ProgressPercent { get; set; }
    public string? ErrorMessage { get; set; }
}

public class HealthStatusDto
{
    public Guid RepoId { get; set; }
    public HealthStatus Status { get; set; }
    public int? ResponseTimeMs { get; set; }
    public DateTime CheckedAt { get; set; }
}

public class CommitActivityDto
{
    public DateTime WeekStart { get; set; }
    public int CommitCount { get; set; }
}

public class FileContentDto
{
    public string Path { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;

    // Inferred from file extension, drives Shiki grammar selection
    public string? Language { get; set; }
}

public class FileTreeDto
{
    public Guid RepoId { get; set; }

    // Flat list; each node carries its own path, parent path can be derived
    // client-side for the spatial file-node layout (Guide.md §5.0)
    public List<FileTreeNodeDto> Nodes { get; set; } = [];
}

public class FileTreeNodeDto
{
    public string Path { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }
}

public class CreateRepoRequestDto
{
    public string RepoUrl { get; set; } = string.Empty;
}