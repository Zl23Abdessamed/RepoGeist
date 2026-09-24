using Markdig;
using Repogeist.Core;

namespace Repogeist.Services;

/// <summary>
/// Converts a repo's raw README markdown (from IGitHubService.FetchReadmeMarkdownAsync)
/// into HTML for RepoDetailDto.ReadmeHtml, computed once during sync and cached rather
/// than re-rendered on every read — see backend.md §6.6.
/// </summary>
public class MarkdownRenderer : IMarkdownRenderer
{
    private readonly MarkdownPipeline _pipeline;

    public MarkdownRenderer()
    {
        // AdvancedExtensions bundles the extension set (tables, autolinks, task lists,
        // footnotes, etc.) needed to render a typical GitHub-flavored README well —
        // without it, common README formatting (tables in particular) falls back to
        // raw text rather than actual HTML.
        _pipeline = new MarkdownPipelineBuilder()
            .UseAdvancedExtensions()
            .Build();
    }

    public string RenderToHtml(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
        {
            return string.Empty;
        }

        return Markdown.ToHtml(markdown, _pipeline);
    }
}