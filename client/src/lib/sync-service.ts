/**
 * Sync service — replays pending offline calls against the server API.
 * Each pending call is POSTed as a service call, then its photos and
 * parts are uploaded. On success the entry is removed from IndexedDB.
 *
 * Concurrency: a module-level mutex prevents two callers from starting a
 * sync at the same time. Previously tab-focus + reconnect + dashboard-load
 * could all trigger sync concurrently and create duplicate service calls.
 *
 * Auto-sync: the module listens for the browser 'online' event and runs a
 * sync automatically when the device reconnects, so techs don't have to
 * navigate to the dashboard to trigger it.
 */

import { getPendingCalls, removePendingCall } from "@/lib/offline-queue";
import { apiRequest } from "@/lib/queryClient";

export interface SyncResult {
  synced: number;
  failed: number;
  skipped?: number; // already-running case
}

let syncInFlight = false;

export async function syncPendingCalls(): Promise<SyncResult> {
  // Single-flight: if another caller is mid-sync, bail out. This is the
  // simplest way to prevent duplicates when the dashboard mounts and the
  // 'online' event fires at the same time.
  if (syncInFlight) return { synced: 0, failed: 0, skipped: 1 };
  syncInFlight = true;
  try {
    const pending = await getPendingCalls();
    let synced = 0;
    let failed = 0;

    for (const entry of pending) {
      try {
        // 1. Create the service call
        const res = await apiRequest("POST", "/api/service-calls", entry.formData);
        const newCall = await res.json();

        // 2. Upload photos
        for (const photo of entry.photos) {
          await apiRequest("POST", `/api/service-calls/${newCall.id}/photos`, {
            photoUrl: photo.photoUrl,
            caption: photo.caption,
            photoType: photo.photoType,
          });
        }

        // 3. Upload parts
        for (const part of entry.parts) {
          if (part.partNumber || part.partDescription) {
            await apiRequest("POST", `/api/service-calls/${newCall.id}/parts`, {
              partNumber: part.partNumber,
              partDescription: part.partDescription,
              quantity: part.quantity || 1,
              source: part.source,
            });
          }
        }

        // 4. Remove from queue on success
        if (entry.id !== undefined) {
          await removePendingCall(entry.id);
        }
        synced++;
      } catch (err) {
        console.error("Failed to sync pending call:", err);
        failed++;
      }
    }

    return { synced, failed };
  } finally {
    syncInFlight = false;
  }
}

// Auto-sync when the browser signals it's back online. Only registered once
// at module load — safe because the module is a singleton.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    // Fire-and-forget; syncInFlight guard covers the race with manual calls.
    syncPendingCalls().catch((e) => console.error("auto-sync on online:", e));
  });
}
