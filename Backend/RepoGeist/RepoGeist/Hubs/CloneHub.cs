using Microsoft.AspNetCore.SignalR;
using Repogeist.Core;

namespace Repogeist.Hubs;

/// <summary>
/// SignalR hub for live clone-job progress (Guide.md §5.0, TechGuide.md §2.7).
/// Cloning fires automatically the moment a repo is ingested — the user didn't click a
/// button to start it — but they may be watching the card they just added, so this
/// pushes queued -> cloning -> ready/failed transitions the same way AnalysisHub does
/// for the (user-triggered, watched-in-the-moment) analysis pipeline. Clients connect
/// at /hub/clone (see Program.cs hub mapping) with no server-invokable methods of its
/// own; it exists purely as a broadcast target.
/// </summary>
public class CloneHub : Hub
{
}

/// <summary>
/// Broadcast helper for CloneHub, mirroring AnalysisHub's BroadcastAnalysisUpdateAsync
/// extension so job classes call a single, typed method rather than reaching for
/// Clients.All.SendAsync(...) with a bare string event name at each call site.
/// </summary>
public static class CloneHubExtensions
{
    public const string CloneUpdateEvent = "CloneUpdate";

    public static Task BroadcastCloneUpdateAsync(this IHubContext<CloneHub> hubContext, CloneStatusDto status)
    {
        return hubContext.Clients.All.SendAsync(CloneUpdateEvent, status);
    }
}