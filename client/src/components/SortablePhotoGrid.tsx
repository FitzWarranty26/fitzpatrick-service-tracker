
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, GripVertical } from "lucide-react";
import { PHOTO_TYPES } from "@shared/schema";

interface PhotoEntry {
  photoUrl: string;
  caption: string;
  photoType: string;
  name?: string;
}

interface SortablePhotoGridProps {
  photos: PhotoEntry[];
  onChange: (photos: PhotoEntry[]) => void;
}

function SortablePhotoItem({
  id,
  photo,
  index,
  onRemove,
  onUpdate,
}: {
  id: string;
  photo: PhotoEntry;
  index: number;
  onRemove: () => void;
  onUpdate: (field: keyof PhotoEntry, value: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto" as any,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-lg overflow-hidden border ${isDragging ? "border-primary shadow-lg" : "border-border"}`}
      data-testid={`photo-entry-${index}`}
    >
      {/* Drag handle + image */}
      <div className="relative">
        <img
          src={photo.photoUrl}
          alt={photo.caption || "Photo"}
          className="w-full aspect-[4/3] object-cover"
        />
        {/* Drag handle overlay */}
        <div
          {...attributes}
          {...listeners}
          className="absolute top-1.5 left-1.5 bg-black/60 rounded-full p-1.5 text-white cursor-grab active:cursor-grabbing touch-none"
          title="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1.5 right-1.5 bg-black/60 rounded-full p-1 text-white hover:bg-red-600/80"
          data-testid={`button-remove-photo-${index}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Controls */}
      <div className="p-2 space-y-1.5 bg-background">
        <select
          value={photo.photoType}
          onChange={(e) => onUpdate("photoType", e.target.value)}
          className="w-full text-xs border border-input rounded px-2 py-1 bg-background text-foreground"
          data-testid={`select-photo-type-${index}`}
        >
          {PHOTO_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          type="text"
          value={photo.caption}
          onChange={(e) => onUpdate("caption", e.target.value)}
          placeholder="Caption…"
          className="w-full text-xs border border-input rounded px-2 py-1 bg-background text-foreground placeholder:text-muted-foreground"
          data-testid={`input-photo-caption-${index}`}
        />
      </div>
    </div>
  );
}

export function SortablePhotoGrid({ photos, onChange }: SortablePhotoGridProps) {
  // Generate stable IDs for each photo
  const ids = photos.map((_, i) => `photo-${i}`);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      onChange(arrayMove(photos, oldIndex, newIndex));
    }
  };

  const removePhoto = (idx: number) => {
    onChange(photos.filter((_, i) => i !== idx));
  };

  const updatePhoto = (idx: number, field: keyof PhotoEntry, value: string) => {
    onChange(photos.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {photos.map((photo, idx) => (
            <SortablePhotoItem
              key={ids[idx]}
              id={ids[idx]}
              photo={photo}
              index={idx}
              onRemove={() => removePhoto(idx)}
              onUpdate={(field, value) => updatePhoto(idx, field, value)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
