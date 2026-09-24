using Repogeist.Core;

namespace Repogeist.Services;

/// <summary>
/// Placeholder IAnalyzerResolver registered until the real analyzer projects
/// (Repogeist.Analyzers.CSharp / Repogeist.Analyzers.JavaScript, or the Analyzers/
/// folders — see TechGuide.md §2.4 vs. §5's open question) land. Always returns null,
/// which AnalysisJobs.RunAnalysisJobAsync already handles gracefully: it marks the job
/// Failed with "Unsupported language" rather than throwing (Guide.md §5.1).
///
/// This exists purely so the DI container has something to hand AnalysisJobs — without
/// any IAnalyzerResolver registration at all, the container can't construct
/// AnalysisJobs, and design-time tooling that builds the whole service provider (e.g.
/// `dotnet ef migrations add`) fails before it ever gets to the DbContext, even though
/// migrations have nothing to do with analyzers. Delete this class and its
/// registration in Program.cs once a real IAnalyzerResolver implementation is added —
/// don't register both.
/// </summary>
public class NoOpAnalyzerResolver : IAnalyzerResolver
{
    public ILanguageAnalyzer? Resolve(string primaryLanguage) => null;
}