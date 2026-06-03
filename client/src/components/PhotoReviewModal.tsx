// PhotoReviewModal
//
// Appears after a tech picks photos from the camera/library on the call
// detail page. They can:
//   • pick a label per photo
//   • set every photo to the same label in one tap ("Apply to all")
//   • drop a photo before upload
//   • add a caption
//   • cancel the whole batch
//
// On confirm, the parent uploads each photo with the chosen label/caption.

import { useState } from "react";
import { X, Loader2, Camera } from "lucide-react";
import { PhotoTypePicker } from "@/components/PhotoTypePicker";

export interface PhotoDraft {
  photoUrl: string;
  fileName: string;
  photoType: string;
  caption: string;
}

interface Props {
  open: boolean;
  drafts: PhotoDraft[];
  onChange: (drafts: PhotoDraft[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isUploading: boolean;
}

export function PhotoReviewModal({ open, drafts, onChange, onCancel, onConfirm, isUploading }: Props) {
  // "Apply to all" sentinel state — not bound to any photo. Picking a label
  // here writes it to every draft. Empty when nothing has been chosen yet so
  // techs see clearly that it's an action, not a value.
  const [bulkLabel, setBulkLabel] = useState("");

  if (!open) return null;

  const updateDraft = (idx: number, patch: Partial<PhotoDraft>) => {
    onChange(drafts.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };
  const removeDraft = (idx: number) => {
    onChange(drafts.filter((_, i) => i !== idx));
  };
  const applyAll = (label: string) => {
    if (!label) return;
    setBulkLabel(label);
    onChange(drafts.map(d => ({ ...d, photoType: label })));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onCancel}
      data-testid="photo-review-modal"
    >
      <div
        className="bg-background w-full sm:max-w-3xl sm:rounded-xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Camera className="w-4 h-4 text-muted-foreground" />
              Review {drafts.length} photo{drafts.length === 1 ? "" : "s"}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Pick a label for each photo before uploading.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isUploading}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted disabled:opacity-50"
            data-testid="button-cancel-review"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Apply to all */}
        {drafts.length > 1 && (
          <div className="px-4 sm:px-6 py-2 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex-shrink-0">
                Apply to all
              </span>
              <div className="flex-1 max-w-[220px]">
                <PhotoTypePicker
                  value={bulkLabel}
                  onChange={applyAll}
                  testIdSuffix="-bulk"
                />
              </div>
            </div>
          </div>
        )}

        {/* Photo grid */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No photos to review.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {drafts.map((d, idx) => (
                <div
                  key={idx}
                  className="border border-border rounded-lg overflow-hidden bg-card"
                  data-testid={`review-photo-${idx}`}
                >
                  <div className="relative bg-muted">
                    <img src={d.photoUrl} alt={d.fileName} className="w-full aspect-[4/3] object-cover" />
                    <button
                      type="button"
                      onClick={() => removeDraft(idx)}
                      disabled={isUploading}
                      className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-red-600/80 text-white rounded-full p-1 disabled:opacity-50"
                      title="Remove from batch"
                      data-testid={`button-remove-review-${idx}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-2.5 space-y-1.5">
                    <PhotoTypePicker
                      value={d.photoType}
                      onChange={(v) => updateDraft(idx, { photoType: v })}
                      testIdSuffix={`-${idx}`}
                    />
                    <input
                      type="text"
                      value={d.caption}
                      onChange={(e) => updateDraft(idx, { caption: e.target.value })}
                      placeholder="Caption (optional)"
                      maxLength={200}
                      className="w-full text-xs border border-input rounded px-2 py-1 bg-background text-foreground placeholder:text-muted-foreground"
                      data-testid={`input-review-caption-${idx}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-4 sm:px-6 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onCancel}
            disabled={isUploading}
            className="text-sm font-medium px-4 py-2 rounded-md hover:bg-muted disabled:opacity-50"
            data-testid="button-discard-review"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isUploading || drafts.length === 0}
            className="text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            data-testid="button-confirm-upload"
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {isUploading ? "Uploading…" : `Upload ${drafts.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
