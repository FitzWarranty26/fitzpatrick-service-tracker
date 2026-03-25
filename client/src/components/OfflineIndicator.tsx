import { useState, useEffect, useCallback } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getPendingCount } from "@/lib/offline-queue";
import { syncPendingCalls } from "@/lib/sync-service";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Desktop variant — shown at the bottom of the sidebar.
 * Displays online/offline status, pending count, and a sync button.
 */
export function OfflineIndicatorDesktop() {
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // IndexedDB may not be available yet
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const interval = setInterval(refreshCount, 5000);
    return () => clearInterval(interval);
  }, [refreshCount]);

  const handleSync = useCallback(async () => {
    if (syncing || !isOnline) return;
    setSyncing(true);
    try {
      const result = await syncPendingCalls();
      await refreshCount();
      // Invalidate dashboard queries so data refreshes
      queryClient.invalidateQueries({ queryKey: ["/api/service-calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent"] });
      if (result.synced > 0) {
        toast({
          title: "Synced",
          description: `${result.synced} service call${result.synced > 1 ? "s" : ""} synced.`,
        });
      }
      if (result.failed > 0) {
        toast({
          title: "Sync issue",
          description: `${result.failed} call${result.failed > 1 ? "s" : ""} failed to sync.`,
          variant: "destructive",
        });
      }
    } finally {
      setSyncing(false);
    }
  }, [syncing, isOnline, refreshCount, toast]);

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="offline-indicator-desktop">
      {/* Status dot + label */}
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isOnline ? "bg-green-400" : "bg-amber-400"
          }`}
        />
        <span className="text-xs text-slate-300">
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      {/* Pending count */}
      {pendingCount > 0 && (
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium">
          {pendingCount} pending
        </span>
      )}

      {/* Sync button */}
      {isOnline && pendingCount > 0 && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-slate-300 hover:text-white hover:bg-sidebar-accent"
          onClick={handleSync}
          disabled={syncing}
          data-testid="button-sync-desktop"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
        </Button>
      )}
    </div>
  );
}

/**
 * Mobile variant — a small dot indicator in the header area.
 */
export function OfflineIndicatorMobile() {
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const refresh = async () => {
      try {
        const count = await getPendingCount();
        setPendingCount(count);
      } catch {
        // Ignore
      }
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1" data-testid="offline-indicator-mobile">
      <span
        className={`w-2 h-2 rounded-full ${
          isOnline ? "bg-green-400" : "bg-amber-400"
        }`}
      />
      {!isOnline && (
        <span className="text-xs text-amber-300">Offline</span>
      )}
      {pendingCount > 0 && (
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium">
          {pendingCount}
        </span>
      )}
    </div>
  );
}
