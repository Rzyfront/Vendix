/** Longest side (px) allowed before the image is scaled down. */
const MAX_RECEIPT_DIMENSION_PX = 2000;

/** Primary export quality (WebP/JPEG) for receipt images. */
const RECEIPT_QUALITY = 0.6;

/** Fallback quality used when the first export is still too heavy. */
const RECEIPT_FALLBACK_QUALITY = 0.45;

/** Size (bytes) above which the export is retried with the fallback quality. */
const RECEIPT_RETRY_THRESHOLD_BYTES = 4.5 * 1024 * 1024;

/** Backend upload limit (bytes) for the original to be kept as-is. */
const RECEIPT_ORIGINAL_MAX_BYTES = 5 * 1024 * 1024;

/** JPEG quality used when converting HEIC/HEIF with heic2any. */
const HEIC_CONVERSION_QUALITY = 0.92;

/** MIME types treated as HEIC/HEIF. */
const HEIC_MIME_TYPES = [
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
];

/** MIME types the backend already accepts as images. */
const BACKEND_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function isHeic(file: File): boolean {
  return (
    HEIC_MIME_TYPES.includes(file.type.toLowerCase()) ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

async function decodeBlob(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close?.(),
      };
    } catch {
      // fall through to the HTMLImageElement fallback
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('RECEIPT_DECODE_FAILED'));
      img.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeHeic(file: File): Promise<Decoded> {
  // Safari decodes HEIC natively.
  if (typeof createImageBitmap === 'function') {
    try {
      return await decodeBlobBitmapOnly(file);
    } catch {
      // not supported by this browser: convert with heic2any
    }
  }
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: HEIC_CONVERSION_QUALITY,
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return decodeBlob(blob);
}

async function decodeBlobBitmapOnly(blob: Blob): Promise<Decoded> {
  const bitmap = await createImageBitmap(blob);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => bitmap.close?.(),
  };
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function exportCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  const webp = await toBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return webp;
  return toBlob(canvas, 'image/jpeg', quality);
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name || 'comprobante';
}

/**
 * Optimizes a payment receipt before upload: PDFs pass through untouched;
 * images (including HEIC/HEIF) are decoded, scaled down to at most
 * MAX_RECEIPT_DIMENSION_PX on the longest side and re-encoded as WebP (JPEG
 * fallback). Throws `Error('RECEIPT_DECODE_FAILED')` when it cannot decode.
 */
export async function compressReceiptImage(file: File): Promise<File> {
  if (isPdf(file)) return file;

  let decoded: Decoded;
  try {
    decoded = isHeic(file) ? await decodeHeic(file) : await decodeBlob(file);
  } catch {
    throw new Error('RECEIPT_DECODE_FAILED');
  }

  try {
    const { source, width, height } = decoded;
    if (!width || !height) throw new Error('RECEIPT_DECODE_FAILED');

    const scale = Math.min(1, MAX_RECEIPT_DIMENSION_PX / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('RECEIPT_DECODE_FAILED');
    // Flatten transparency onto white: JPEG fallback has no alpha channel.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    let blob = await exportCanvas(canvas, RECEIPT_QUALITY);
    if (blob && blob.size > RECEIPT_RETRY_THRESHOLD_BYTES) {
      blob = (await exportCanvas(canvas, RECEIPT_FALLBACK_QUALITY)) ?? blob;
    }
    if (!blob) throw new Error('RECEIPT_DECODE_FAILED');

    if (
      blob.size > file.size &&
      BACKEND_IMAGE_MIME_TYPES.includes(file.type) &&
      file.size <= RECEIPT_ORIGINAL_MAX_BYTES
    ) {
      return file;
    }

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${baseName(file.name)}.${ext}`, {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch (e) {
    throw e instanceof Error && e.message === 'RECEIPT_DECODE_FAILED'
      ? e
      : new Error('RECEIPT_DECODE_FAILED');
  } finally {
    decoded.release();
  }
}
