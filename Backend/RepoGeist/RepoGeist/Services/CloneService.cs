using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Repogeist.Core;

namespace Repogeist.Services;

/// <summary>
/// Owns the actual git-clone mechanics, shared by CloneJobs (the automatic,
/// fire-on-ingestion background job) and AnalysisJobs (which verifies/repairs a clone
/// before analyzing rather than assuming one exists — Guide.md §5.0, backend.md §1).
///
/// Unlike the old inline-temp-dir approach, clones here are durable: they live under a
/// configured root directory, not Path.GetTempPath(), and are never deleted after a
/// single job run — GetExistingClonePathAsync is what lets later jobs (a repeat
/// analysis, or the Code view reading a file) find and reuse the same clone instead of
/// re-cloning every time.
/// </summary>
public class CloneService(
    ICloneRepository cloneRepository,
    IConfiguration configuration,
    ILogger<CloneService> logger) : ICloneService
{
    // Durable root for all repo clones, e.g. "/var/repogeist/clones" in production or a
    // gitignored local folder in dev. Configurable via Clones:RootPath so deploys can
    // point it at a mounted volume.
    private readonly string _rootPath = configuration["Clones:RootPath"]
        ?? Path.Combine(AppContext.BaseDirectory, "clones");

    /// <summary>
    /// Returns the local path to a valid, existing clone, or null if none exists / the
    /// path is stale. This is the check both CloneJobs and AnalysisJobs call before
    /// doing any actual git work (Guide.md §5.0's "check before re-cloning" rule).
    ///
    /// Deliberately checks the filesystem, not just the CloneJob row's Status — a
    /// CloneJob can claim Ready while the directory itself is gone (container restart,
    /// disk cleanup, manual intervention), and that mismatch is exactly what should
    /// trigger a re-clone rather than a failure (backend.md §6.8).
    /// </summary>
    public async Task<string?> GetExistingClonePathAsync(Guid repoId)
    {
        var latestJob = await cloneRepository.GetLatestForRepoAsync(repoId);

        if (latestJob is null || latestJob.Status != CloneStatus.Ready || latestJob.LocalPath is null)
        {
            return null;
        }

        if (!Directory.Exists(latestJob.LocalPath))
        {
            logger.LogWarning(
                "CloneJob {JobId} for repo {RepoId} claims Ready at {LocalPath}, but the directory no longer exists; treating as no clone.",
                latestJob.Id, repoId, latestJob.LocalPath);
            return null;
        }

        return latestJob.LocalPath;
    }

    /// <summary>
    /// Shallow (depth 1 — no history needed for static analysis) git clone into a
    /// fresh, durable directory under the configured clones root. Shells out to the
    /// system `git` binary rather than a library like LibGit2Sharp to keep the
    /// dependency surface small; requires `git` to be on PATH in the container/host
    /// running this.
    /// </summary>
    public async Task<string> CloneAsync(string owner, string name)
    {
        Directory.CreateDirectory(_rootPath);

        var targetPath = Path.Combine(_rootPath, owner, name, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(targetPath);

        var cloneUrl = $"https://github.com/{owner}/{name}.git";

        var startInfo = new ProcessStartInfo
        {
            FileName = "git",
            ArgumentList = { "clone", "--depth", "1", cloneUrl, targetPath },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Failed to start git process.");

        var stderrTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        if (process.ExitCode != 0)
        {
            var stderr = await stderrTask;
            throw new InvalidOperationException(
                $"git clone failed for {owner}/{name} (exit code {process.ExitCode}): {stderr}");
        }

        return targetPath;
    }
}