namespace Repogeist.Core;

public interface ILanguageAnalyzer
{
    Task<DependencyGraphDto> AnalyzeAsync(string repoPath);
    bool CanHandle(string language);
}

public interface IAnalyzerResolver
{
    // Iterates registered ILanguageAnalyzer implementations, returns the first whose
    // CanHandle(language) is true. Returns null if no analyzer supports the repo's language(s).
    ILanguageAnalyzer? Resolve(string primaryLanguage);
}

public interface IRepoRepository
{
    Task<Repo?> GetByOwnerAndNameAsync(string owner, string name);
    Task<List<Repo>> GetAllAsync();
    Task AddAsync(Repo repo);
    Task UpdateAsync(Repo repo);

    // Child-collection persistence — replaces each set wholesale on sync,
    // since GitHub's data is the source of truth and diffing isn't worth it at this scale.
    // ReplaceContributorsAsync upserts each Contributor by GithubUsername rather than
    // inserting blindly, since Contributor rows are shared across repos and
    // GithubUsername is unique. It takes (Contributor, CommitCount) pairs rather than
    // a bare List<Contributor> because CommitCount is repo-specific (it lives on the
    // RepoContributor join row) while Contributor itself is shared across repos —
    // bundling a transient CommitCount onto Contributor would misrepresent per-repo
    // data as per-contributor data.
    Task ReplaceLanguageStatsAsync(Guid repoId, List<LanguageStat> stats);
    Task ReplaceContributorsAsync(Guid repoId, List<(Contributor Contributor, int CommitCount)> contributors);
    Task ReplaceCommitActivityAsync(Guid repoId, List<CommitActivityDto> activity);
}

public interface IHealthCheckRepository
{
    Task AddAsync(HealthCheck check);
    Task<List<HealthCheck>> GetHistoryAsync(Guid repoId);
    Task<HealthCheck?> GetLatestAsync(Guid repoId);
}

public interface ICloneRepository
{
    Task<CloneJob> CreateJobAsync(Guid repoId);
    Task<CloneJob?> GetJobAsync(Guid jobId);
    Task<CloneJob?> GetLatestForRepoAsync(Guid repoId);
    Task UpdateJobStatusAsync(Guid jobId, CloneStatus status, string? localPath = null, string? errorMessage = null);
}

public interface ICloneService
{
    // Returns the local path to a valid, existing clone, or null if none exists / it's stale.
    // This is the check that both CloneJobs and AnalysisJobs call before doing any actual git work —
    // see Guide.md §5.0's "analysis checks for the clone first" rule.
    Task<string?> GetExistingClonePathAsync(Guid repoId);

    // Shallow git clone to a durable working directory, returns local path
    Task<string> CloneAsync(string owner, string name);
}

public interface IAnalysisRepository
{
    Task<AnalysisJob> CreateJobAsync(Guid repoId);
    Task<AnalysisJob?> GetJobAsync(Guid jobId);

    // Drives RepoDetailDto.AnalysisStatus
    Task<AnalysisJob?> GetLatestForRepoAsync(Guid repoId);
    Task UpdateJobStatusAsync(Guid jobId, AnalysisStatus status, string? errorMessage = null);

    // Writes GraphNodes/GraphEdges and the cached JSONB column
    Task SaveGraphAsync(Guid repoId, DependencyGraphDto graph);
    Task<DependencyGraphDto?> GetGraphAsync(Guid repoId);
}

public interface IGitHubService
{
    Task<Repo> FetchRepoMetadataAsync(string owner, string name);

    // Raw markdown as GitHub returns it
    Task<string> FetchReadmeMarkdownAsync(string owner, string name);
    Task<List<Contributor>> FetchContributorsAsync(string owner, string name);
    Task<List<LanguageStat>> FetchLanguageStatsAsync(string owner, string name);
    Task<List<CommitActivityDto>> FetchCommitActivityAsync(string owner, string name);
}

public interface IMarkdownRenderer
{
    // Used to populate RepoDetailDto.ReadmeHtml before it's cached
    string RenderToHtml(string markdown);
}