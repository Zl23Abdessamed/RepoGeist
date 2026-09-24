using Microsoft.AspNetCore.SignalR;
using Repogeist.Core;

namespace Repogeist.Hubs;

/// <summary>
/// SignalR hub at /hub/health (see backend.md §3 / TechGuide.md §4.2) that pushes live
/// health-check status changes to connected clients.
///
/// This hub is server-push only — repos' up/down state can change at any time,
/// independent of user action (TechGuide.md §2.7), so there are no client-callable
/// methods here. Broadcasts are triggered from HealthCheckWorker after each check
/// cycle via IHubContext&lt;HealthHub&gt;, not by anything a connected client sends.
/// </summary>
public class HealthHub : Hub
{
    /// <summary>
    /// Pushes a health status update to every connected client. Called by
    /// HealthCheckWorker.RecordAndBroadcastAsync (via IHubContext&lt;HealthHub&gt;) once a
    /// health check has been persisted — see backend.md §6.6.
    /// </summary>
    public async Task BroadcastHealthUpdate(HealthStatusDto status)
    {
        await Clients.All.SendAsync("HealthUpdate", status);
    }
}

/// <summary>
/// Extension so server-side callers (HealthCheckWorker) can broadcast through
/// IHubContext&lt;HealthHub&gt; without instantiating a Hub instance themselves — Hub
/// methods are designed to run in response to client connections, not to be called
/// directly from application code.
/// </summary>
public static class HealthHubContextExtensions
{
    public static async Task BroadcastHealthUpdateAsync(this IHubContext<HealthHub> hubContext, HealthStatusDto status)
    {
        await hubContext.Clients.All.SendAsync("HealthUpdate", status);
    }
}