// PhotoTypePicker
//
// A reusable picker for the photo "label" / "type" field. Shows built-in
// PHOTO_TYPES (Before, After, Product Label, Serial Number, Damage, Other)
// merged with user-saved custom labels (Migration 32 / photo_label_presets).
//
// When the user picks "Custom…" they get a small inline input + a "Save for
// future use" checkbox. If checked, the label is persisted via
// POST /api/photo-label-presets so it shows up in the dropdown next time.
//
// Used in:
//   • SortablePhotoGrid (edit mode + new-call upload)
//   • PhotoReviewModal (direct upload review step on the call detail page)

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Check } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Pass a stable id so multiple pickers on one page don't share state. */
  testIdSuffix?: string;
  className?: string;
}

interface PresetsResponse {
  labels: string[];
  saved: Array<{ id: number; label: string }>;
}

const CUSTOM_SENTINEL = "__custom__";

export function PhotoTypePicker({ value, onChange, testIdSuffix = "", className = "" }: Props) {
  const queryClient = useQueryClient();
  // Pull the merged list of built-in + user-saved labels. Cached across the
  // session — saving a new preset triggers an invalidation so all open pickers
  // refresh together.
  const { data } = useQuery<PresetsResponse>({
    queryKey: ["/api/photo-label-presets"],
    queryFn: async () => (await apiRequest("GET", "/api/photo-label-presets")).json(),
    staleTime: 60_000,
  });
  const labels = data?.labels ?? ["Before", "After", "Product Label", "Serial Number", "Damage", "Other"];

  // If the picker is rendered for an existing photo with a label that isn't
  // in the current list (e.g. a saved preset that was later deleted), still
  // show it as the selected option so we never lose the user's data.
  const labelsWithCurrent = labels.includes(value) || !value ? labels : [...labels, value];

  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [savePreset, setSavePreset] = useState(true);

  const commitCustom = async () => {
    const trimmed = customText.trim();
    if (!trimmed) {
      setShowCustom(false);
      return;
    }
    onChange(trimmed);
    if (savePreset) {
      try {
        await apiRequest("POST", "/api/photo-label-presets", { label: trimmed });
        queryClient.invalidateQueries({ queryKey: ["/api/photo-label-presets"] });
      } catch {
        // If saving the preset fails (e.g. duplicate), the photo still gets
        // the right label — we just don't add it to the picker. Non-fatal.
      }
    }
    setShowCustom(false);
    setCustomText("");
  };

  if (showCustom) {
    return (
      <div className={`space-y-1.5 ${className}`}>
        <input
          type="text"
          autoFocus
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitCustom(); }
            if (e.key === "Escape") { e.preventDefault(); setShowCustom(false); setCustomText(""); }
          }}
          placeholder="Custom label…"
          maxLength={64}
          className="w-full text-xs border border-input rounded px-2 py-1 bg-background text-foreground placeholder:text-muted-foreground"
          data-testid={`input-custom-photo-type${testIdSuffix}`}
        />
        <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={savePreset}
            onChange={(e) => setSavePreset(e.target.checked)}
            className="rounded border-input w-3 h-3"
            data-testid={`checkbox-save-preset${testIdSuffix}`}
          />
          Save for future use
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={commitCustom}
            className="flex-1 text-[10.5px] font-medium px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid={`button-confirm-custom${testIdSuffix}`}
          >
            <Check className="w-3 h-3 inline mr-1" /> Use
          </button>
          <button
            type="button"
            onClick={() => { setShowCustom(false); setCustomText(""); }}
            className="text-[10.5px] font-medium px-2 py-1 rounded border border-input hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      value={value || "Other"}
      onChange={(e) => {
        if (e.target.value === CUSTOM_SENTINEL) {
          setShowCustom(true);
          setCustomText("");
        } else {
          onChange(e.target.value);
        }
      }}
      className={`w-full text-xs border border-input rounded px-2 py-1 bg-background text-foreground ${className}`}
      data-testid={`select-photo-type${testIdSuffix}`}
    >
      {labelsWithCurrent.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
      <option disabled>──────────</option>
      <option value={CUSTOM_SENTINEL}>+ Custom label…</option>
    </select>
  );
}
