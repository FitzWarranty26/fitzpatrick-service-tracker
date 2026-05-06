/**
 * Compress and resize an image file to a maximum dimension and quality.
 * Returns a base64 data URL string.
 *
 * iPhone photos are typically 4032x3024 (12MP) and 3-8MB.
 * This resizes them to max 1600px on the longest side and compresses
 * to JPEG quality 0.7, resulting in ~100-300KB per photo.
 *
 * Handles:
 *  - HEIC from iOS: detected by extension/MIME, surfaces a friendly error
 *    message (the browser cannot decode HEIC natively).
 *  - EXIF rotation: uses createImageBitmap with imageOrientation='from-image'
 *    when available so photos appear right-side up. Falls back to Image().
 *  - Oversized files: rejects inputs > 50 MB up front before they eat memory.
 *  - Non-image MIME types: rejects PDFs etc. with a clear error.
 */

// Hard cap before we even attempt to decode — prevents OOM on bad input.
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

export async function compressImage(
  file: File,
  maxDimension = 1600,
  quality = 0.7
): Promise<string> {
  // Type / size preflight — fail fast with a useful message.
  if (!file || file.size === 0) {
    throw new UnsupportedImageError("Empty file.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new UnsupportedImageError(
      `Image is ${Math.round(file.size / 1024 / 1024)} MB, which is too large. Max 50 MB.`
    );
  }
  const name = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  const isHeic = name.endsWith(".heic") || name.endsWith(".heif")
    || mime === "image/heic" || mime === "image/heif";
  if (isHeic) {
    throw new UnsupportedImageError(
      "HEIC photos from iPhone aren't supported in the browser. In iOS Settings → Camera → Formats, choose 'Most Compatible' to save as JPEG."
    );
  }
  if (mime && !mime.startsWith("image/")) {
    throw new UnsupportedImageError(`Unsupported file type: ${mime}. Please choose a photo.`);
  }

  // Prefer createImageBitmap — it respects EXIF orientation so rotated iPhone
  // photos don't come out sideways. Falls back to HTMLImageElement on older
  // browsers (Safari 14-, older Firefox).
  let bitmap: ImageBitmap | null = null;
  let width = 0;
  let height = 0;
  let source: CanvasImageSource | null = null;

  if (typeof createImageBitmap === "function") {
    try {
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
        premultiplyAlpha: "default",
        colorSpaceConversion: "default",
      } as any);
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    } catch {
      bitmap = null;
    }
  }

  if (!bitmap) {
    // Fallback path — <img> + object URL, no EXIF auto-rotation on some browsers.
    const loaded = await loadImage(file);
    width = loaded.img.width;
    height = loaded.img.height;
    source = loaded.img;
    loaded.cleanup();
  }

  // Scale down if either dimension exceeds max
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap?.close();
    throw new Error("Failed to get canvas context");
  }
  if (!source) {
    throw new Error("Failed to load image source");
  }
  ctx.drawImage(source, 0, 0, width, height);
  bitmap?.close();

  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(file: File): Promise<{ img: HTMLImageElement; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({
      img,
      cleanup: () => URL.revokeObjectURL(url),
    });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UnsupportedImageError("Failed to decode this image — the file may be corrupt or in an unsupported format."));
    };
    img.src = url;
  });
}
