using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Mvc;
using Repogeist.Core;

namespace Repogeist.Controllers;

/// <summary>
/// Clone/Code endpoints — clone job status, file tree, and file content, all reading
/// from the repo's durable clone (Guide.md §5.0, backend.md §3/§6.4). Deliberately
/// separate from AnalysisController: Code works off the clone alone and never depends
/// on whether Tier 2 analysis has ever run (Guide.md §5.2).
/// </summary>
[ApiController]
[Route("api/repos/{owner}/{name}")]
public class CloneController : ControllerBase
{
    private readonly IRepoRepository _repoRepository;
    private readonly ICloneRepository _cloneRepository;
    private readonly ICloneService _cloneService;
    private readonly ILogger<CloneController> _logger;

    public CloneController(
        IRepoRepository repoRepository,
        ICloneRepository cloneRepository,
        ICloneService cloneService,
        ILogger<CloneController> logger)
    {
        _repoRepository = repoRepository;
        _cloneRepository = cloneRepository;
        _cloneService = cloneService;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name}/clone-status — current clone state
    /// (queued/cloning/ready/failed). Fetched once on load; kept live afterward via
    /// /hub/clone rather than re-polled (TechGuide.md §2.7). No CloneJob yet (e.g. the
    /// automatic ingestion-time job hasn't reached the database yet, in a race right
    /// after POST /api/repos returns) reads as Queued rather than 404, since a clone
    /// is always expected to exist or be on its way for an ingested repo.
    /// </summary>
    [HttpGet("clone-status")]
    [ProducesResponseType(typeof(CloneStatusDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CloneStatusDto>> GetCloneStatus(string owner, string name)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        var latestJob = await _cloneRepository.GetLatestForRepoAsync(repo.Id);

        var dto = new CloneStatusDto
        {
            RepoId = repo.Id,
            JobId = latestJob?.Id ?? Guid.Empty,
            Status = (latestJob?.Status ?? CloneStatus.Queued).ToString(),
            ProgressPercent = null,
            ErrorMessage = latestJob?.ErrorMessage
        };

        return Ok(dto);
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name}/file-tree — the repo's file tree from the clone,
    /// for the Code view's spatial file-node layout (Guide.md §5.2). Repairs the clone
    /// inline (re-clones) if it's missing, rather than 404ing — Code should "just
    /// work" whenever a person opens it, independent of clone job history
    /// (Guide.md §5.0).
    /// </summary>
    [HttpGet("file-tree")]
    [ProducesResponseType(typeof(FileTreeDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FileTreeDto>> GetFileTree(string owner, string name)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        var repoPath = await EnsureClonePathAsync(repo);

        var nodes = BuildFileTree(repoPath);

        return Ok(new FileTreeDto
        {
            RepoId = repo.Id,
            Nodes = nodes
        });
    }

    /// <summary>
    /// GET /api/repos/{owner}/{name}/files/{*path} — a single file's content for the
    /// "familiar code view" (Guide.md §5.2), syntax-highlighted client-side via Shiki
    /// (TechGuide.md §1.8). Reads from the clone via ICloneService; if the clone is
    /// missing (cleaned up, or the original CloneJob failed), triggers a re-clone
    /// inline before serving the file rather than 404ing (Guide.md §5.0).
    /// </summary>
    [HttpGet("files/{*path}")]
    [ProducesResponseType(typeof(FileContentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FileContentDto>> GetFileContent(string owner, string name, string path)
    {
        var repo = await _repoRepository.GetByOwnerAndNameAsync(owner, name);
        if (repo is null)
        {
            return NotFound();
        }

        if (string.IsNullOrWhiteSpace(path))
        {
            return BadRequest("A file path is required.");
        }

        var repoPath = await EnsureClonePathAsync(repo);

        var fullPath = ResolveSafeFilePath(repoPath, path);
        if (fullPath is null)
        {
            // Path escapes the clone root (e.g. "../../etc/passwd") — treat as not
            // found rather than leaking whether the traversal target exists.
            return NotFound();
        }

        if (!System.IO.File.Exists(fullPath))
        {
            return NotFound($"'{path}' was not found in {owner}/{name}.");
        }

        var content = await System.IO.File.ReadAllTextAsync(fullPath);

        return Ok(new FileContentDto
        {
            Path = path,
            Content = content,
            Language = InferLanguage(fullPath)
        });
    }

    /// <summary>
    /// Returns a valid local clone path for the repo, cloning inline if
    /// ICloneService.GetExistingClonePathAsync comes back empty — the same
    /// check-then-repair pattern AnalysisJobs uses (Guide.md §5.0), just invoked
    /// synchronously from a request instead of a background job, since a person is
    /// actively waiting on Code to open right now.
    /// </summary>
    private async Task<string> EnsureClonePathAsync(Repo repo)
    {
        var existingPath = await _cloneService.GetExistingClonePathAsync(repo.Id);
        if (existingPath is not null)
        {
            return existingPath;
        }

        _logger.LogInformation(
            "CloneController: no valid clone found for {Owner}/{Name} ({RepoId}); cloning inline.",
            repo.Owner, repo.Name, repo.Id);

        return await _cloneService.CloneAsync(repo.Owner, repo.Name);
    }

    /// <summary>
    /// Walks the clone directory into a flat FileTreeNodeDto list, skipping .git —
    /// that's clone plumbing, not part of the repo's own file tree, and would clutter
    /// the spatial file-node layout with noise nobody asked to see.
    /// </summary>
    private static List<FileTreeNodeDto> BuildFileTree(string repoPath)
    {
        var nodes = new List<FileTreeNodeDto>();
        var root = new DirectoryInfo(repoPath);

        void Walk(DirectoryInfo dir)
        {
            foreach (var entry in dir.EnumerateFileSystemInfos().OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase))
            {
                if (entry.Name == ".git")
                {
                    continue;
                }

                var relativePath = Path.GetRelativePath(repoPath, entry.FullName).Replace('\\', '/');
                var isDirectory = entry is DirectoryInfo;

                nodes.Add(new FileTreeNodeDto
                {
                    Path = relativePath,
                    IsDirectory = isDirectory
                });

                if (entry is DirectoryInfo subDir)
                {
                    Walk(subDir);
                }
            }
        }

        Walk(root);
        return nodes;
    }

    /// <summary>
    /// Resolves the requested relative path against the clone root and confirms the
    /// result is still inside that root, rejecting path traversal
    /// (e.g. "../../../etc/passwd") before it ever reaches File.Exists/ReadAllTextAsync.
    /// Returns null if the resolved path escapes repoPath.
    /// </summary>
    private static string? ResolveSafeFilePath(string repoPath, string relativePath)
    {
        var normalizedRoot = Path.GetFullPath(repoPath);
        var candidate = Path.GetFullPath(Path.Combine(normalizedRoot, relativePath));

        var comparison = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

        var rootWithSeparator = normalizedRoot.EndsWith(Path.DirectorySeparatorChar)
            ? normalizedRoot
            : normalizedRoot + Path.DirectorySeparatorChar;

        return candidate.StartsWith(rootWithSeparator, comparison) ? candidate : null;
    }

    /// <summary>
    /// Infers a Shiki grammar name from the file extension (TechGuide.md §1.8). A
    /// small, deliberately incomplete map — extend as the "familiar code view" gets
    /// exercised against real repos; an unrecognized extension just means Shiki falls
    /// back to plain text client-side, not a broken response.
    /// </summary>
    private static string? InferLanguage(string filePath)
    {
        return Path.GetExtension(filePath).ToLowerInvariant() switch
        {
            ".cs" => "csharp",
            ".ts" => "typescript",
            ".tsx" => "tsx",
            ".js" => "javascript",
            ".jsx" => "jsx",
            ".json" => "json",
            ".md" => "markdown",
            ".py" => "python",
            ".html" => "html",
            ".css" => "css",
            ".yml" or ".yaml" => "yaml",
            ".sql" => "sql",
            ".sh" => "bash",
            ".xml" => "xml",
            ".csproj" or ".sln" => "xml",
            _ => null
        };
    }
}