using Octokit;
using Repogeist.Core;

namespace Repogeist.Services;

/// <summary>
/// Wraps Octokit.net calls needed to sync a public repo's Tier 1 data.
/// The underlying GitHubClient is configured with a single app-owned PAT
/// (public scope only) purely to raise the API rate limit — see backend.md §7
/// and Guide.md §4.2. This token is never exposed to the frontend.
/// </summary>
public class GitHubService : IGitHubService
{
    private readonly IGitHubClient _client;

    public GitHubService(IGitHubClient client)
    {
        _client = client;
    }

    public async Task<Repo> FetchRepoMetadataAsync(string owner, string name)
    {
        var ghRepo = await _client.Repository.Get(owner, name);

        return new Repo
        {
            Id = Guid.NewGuid(),
            Owner = ghRepo.Owner.Login,
            Name = ghRepo.Name,
            Description = ghRepo.Description,
            Topics = ghRepo.Topics is null ? [] : [.. ghRepo.Topics],
            PrimaryLanguage = ghRepo.Language,
            Stars = ghRepo.StargazersCount,
            Forks = ghRepo.ForksCount,
            LiveDemoUrl = string.IsNullOrWhiteSpace(ghRepo.Homepage) ? null : ghRepo.Homepage,
            LastSyncedAt = DateTime.UtcNow
        };
    }

    public async Task<string> FetchReadmeMarkdownAsync(string owner, string name)
    {
        // VERIFY WITH INTELLISENSE: using Repository.Content.GetReadme(owner, name),
        // which Octokit documents as returning README metadata with a decoded
        // .Content string (raw markdown). If the installed version instead returns
        // base64-encoded content here, add a Convert.FromBase64String + UTF8 decode step.
        try
        {
            var readme = await _client.Repository.Content.GetReadme(owner, name);
            return readme.Content;
        }
        catch (NotFoundException)
        {
            // Repo has no README — not an error condition for sync purposes.
            return string.Empty;
        }
    }

    public async Task<List<Core.Contributor>> FetchContributorsAsync(string owner, string name)
    {
        var ghContributors = await _client.Repository.GetAllContributors(owner, name);

        return ghContributors
            .Select(c => new Core.Contributor
            {
                Id = Guid.NewGuid(),
                GithubUsername = c.Login,
                AvatarUrl = c.AvatarUrl
            })
            .ToList();
    }

    public async Task<List<LanguageStat>> FetchLanguageStatsAsync(string owner, string name)
    {
        // Returns a Dictionary<string, long> of language -> byte count, exactly
        // mirroring GitHub's own language breakdown (see Guide.md §4.2).
        var languages = await _client.Repository.GetAllLanguages(owner, name);

        return languages
            .Select(l => new LanguageStat
            {
                Id = Guid.NewGuid(),
                Language = l.Name,
                ByteCount = l.NumberOfBytes
            })
            .ToList();
    }

    public async Task<List<CommitActivityDto>> FetchCommitActivityAsync(string owner, string name)
    {
        // FIX WITH INTELLISENSE: the exact member name on IStatisticsClient could not be
        // confirmed from documentation (compiler rejected "GetWeeklyCommitActivity" —
        // that name doesn't exist on this package version). Type `_client.Repository
        // .Statistics.` in your editor and autocomplete to the real method that returns
        // weekly commit counts for the past year (GitHub's
        // GET /repos/{owner}/{repo}/stats/commit_activity endpoint) — candidates going
        // by Octokit's naming conventions elsewhere in the SDK include
        // GetCommitActivity / GetWeeklyCommitActivity / GetCommitActivityForTheLastYear.
        // Once found, replace the call below and adjust the shape of `weeklyActivity`
        // and the per-week Select() to match whatever that method actually returns
        // (likely IReadOnlyList<T> directly, or a wrapper with an .Activity/.Weeks list —
        // check for a Total and a Week/WeekStart-shaped property on each item, along
        // with whether Week is a Unix timestamp (long) or already a DateTimeOffset).
        var weeklyActivity = await _client.Repository.Statistics.GetCommitActivity(owner, name);

        if (weeklyActivity?.Activity is null)
        {
            return [];
        }

        return weeklyActivity.Activity
            .Select(week => new CommitActivityDto
            {
                WeekStart = DateTimeOffset.FromUnixTimeSeconds(week.Week).UtcDateTime,
                CommitCount = week.Total
            })
            .ToList();
    }
}