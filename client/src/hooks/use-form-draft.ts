import { useEffect, useRef } from "react";
import type { UseFormReturn, FieldValues } from "react-hook-form";

/**
 * Auto-save form state to localStorage on every change and restore it on
 * mount. Also shows a native browser warning if the user tries to close
 * the tab while there's unsaved content.
 *
 * Why this exists: the New Service Call form is long. Before this, a
 * refresh, accidental back-button, or session expiry mid-form would wipe
 * everything the tech had typed. Now drafts survive reloads.
 *
 * clearDraft() must be called explicitly after a successful save so the
 * draft doesn't immediately reappear the next time the form opens.
 */
export function useFormDraft<T extends FieldValues>(
  form: UseFormReturn<T>,
  storageKey: string,
  options: {
    /** Skip restoring the draft (e.g. when the form is in edit mode for an
     * existing record, or a followUpId/copyFromId is pre-filling it). */
    skipRestore?: boolean;
    /** Warn the user with a native dialog if they close the tab with
     * unsaved draft. Default true. */
    warnOnUnload?: boolean;
    /** Debounce ms between saves. Default 500. */
    debounceMs?: number;
  } = {}
) {
  const { skipRestore = false, warnOnUnload = true, debounceMs = 500 } = options;
  const restoredRef = useRef(false);
  const isDirtyRef = useRef(false);

  // Restore on mount, once
  useEffect(() => {
    if (restoredRef.current || skipRestore) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && typeof saved === "object") {
        form.reset({ ...form.getValues(), ...saved });
      }
    } catch {
      // Corrupt JSON \u2014 just drop the draft silently.
      localStorage.removeItem(storageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, skipRestore]);

  // Auto-save on change, debounced
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = form.watch((values) => {
      if (!restoredRef.current) return; // don't save before we've restored
      isDirtyRef.current = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(values));
        } catch {
          // Quota exceeded or private mode \u2014 nothing we can do, silent.
        }
      }, debounceMs);
    });
    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [form, storageKey, debounceMs]);

  // Close-tab warning
  useEffect(() => {
    if (!warnOnUnload) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      // Modern browsers require returnValue to be set; they'll show their
      // own generic message regardless of what we put in it.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [warnOnUnload]);

  const clearDraft = () => {
    isDirtyRef.current = false;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  };

  return { clearDraft };
}
