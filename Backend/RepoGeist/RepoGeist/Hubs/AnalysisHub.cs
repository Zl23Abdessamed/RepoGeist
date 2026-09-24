using Microsoft.AspNetCore.SignalR;
using Repogeist.Core;

namespace Repogeist.Hubs;

/// <summary>
/// SignalR hub at /hub/analysis (see backend.md §3 / TechGuide.md §4.2) that pushes live
/// analysis job status changes (queued/running/succeeded/failed) to connected clients.
///
/// This hub is server-push only. The frontend opens a connection right after triggering
/// an analysis job and receives a single push the moment Hangfire reports a state change
/// (TechGuide.md §2.7) — there are no client-callable methods here. Broadcasts are
/// triggered from AnalysisJobs.RunAnalysisJobAsync via IHubContext&lt;AnalysisHub&gt;.
/// </summary>
public class AnalysisHub : Hub
{
    /// <summary>
    /// Pushes an analysis job status update to every connected client. Called at each
    /// state transition (Running, Succeeded, Failed) in AnalysisJobs.RunAnalysisJobAsync
    /// (via IHubContext&lt;AnalysisHub&gt;) — see backend.md §6.6.
    /// </summary>
    public async Task BroadcastAnalysisUpdate(AnalysisStatusDto status)
    {
        await Clients.All.SendAsync("AnalysisUpdate", status);
    }
}

/// <summary>
/// Extension so server-side callers (AnalysisJobs) can broadcast through
/// IHubContext&lt;AnalysisHub&gt; without instantiating a Hub instance themselves — Hub
/// methods are designed to run in response to client connections, not to be called
/// directly from application code.
/// </summary>
public static class AnalysisHubContextExtensions
{
    public static async Task BroadcastAnalysisUpdateAsync(this IHubContext<AnalysisHub> hubContext, AnalysisStatusDto status)
    {
        await hubContext.Clients.All.SendAsync("AnalysisUpdate", status);
    }
}