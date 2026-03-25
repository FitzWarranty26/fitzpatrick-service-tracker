/**
 * Sync service — replays pending offline calls against the server API.
 * Each pending call is POSTed as a service call, then its photos and
 * parts are uploaded. On success the entry is removed from IndexedDB.
 */

import { getPendingCalls, removePendingCall } from "@/lib/offline-queue";
import { apiRequest } from "@/lib/queryClient";

export interface SyncResult {
  synced: number;
  failed: number;
}

export async function syncPendingCalls(): Promise<SyncResult> {
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
          photoUrl: photo.dataUrl,
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
}
