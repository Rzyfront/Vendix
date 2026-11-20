/**
 * Image preparation for AI reading (plan ia-cargas §3.2 step 6). The ONE sharp
 * pipeline of ai-ingest: EXIF rotation, size cap, JPEG output and strips for
 * very tall photos (long lists, tickets). `DocumentPagesService` uses it for
 * image uploads, so every AI load prepares photos the same way.
 */
const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- sharp 0.35 types are ESM-only (export default) but CJS runtime exports the function

/** Longest edge sent to the model (same as the scanners that predate ai-ingest). */
export const AI_IMAGE_MAX_EDGE = 1536;
/** Decoding bomb guard (pixels of the source image). */
export const AI_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
/** height / width above which a photo is read in strips. */
export const TALL_IMAGE_ASPECT = 2.2;
/** height / width of each strip. */
export const STRIP_ASPECT = 1.4;
/** Share of a strip repeated in the next one, so no text line is cut in two. */
export const STRIP_OVERLAP = 0.08;
export const MAX_IMAGE_STRIPS = 10;

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

export type ImagePrepFailure = 'unsupported' | 'too_large' | 'multipage' | 'unreadable';

export class ImagePrepError extends Error {
  constructor(
    readonly reason: ImagePrepFailure,
    /** Spanish, ready to show. */
    message: string,
  ) {
    super(message);
    this.name = 'ImagePrepError';
  }
}

export interface ImagePrepOptions {
  /** Longest edge of each output image. Default {@link AI_IMAGE_MAX_EDGE}. */
  maxEdge?: number;
  /** JPEG quality. Default 85. */
  quality?: number;
  /** Cut very tall photos into overlapping strips. Default false. */
  splitTall?: boolean;
  /** Strip cap when `splitTall`. Default {@link MAX_IMAGE_STRIPS}. */
  maxStrips?: number;
}

export interface PreparedAiImage {
  buffer: Buffer;
  mime: 'image/jpeg';
  /** 1-based strip number; 1 of 1 for a photo that was not split. */
  strip: number;
  strips: number;
}

export interface StripBox {
  top: number;
  height: number;
}

/**
 * Whether this sharp build decodes HEIC (HEVC) photos. The prebuilt
 * libvips only lists `.avif` for heif input; a custom build with libde265
 * would list `.heic` and HEIC uploads would start working without changes.
 */
export function canDecodeHeic(): boolean {
  const suffixes = (
    sharp.format as unknown as Record<string, { input?: { fileSuffix?: string[] } }>
  ).heif?.input?.fileSuffix;
  return Array.isArray(suffixes) && suffixes.includes('.heic');
}

/** Message for an HEIC photo the server cannot decode. */
export const HEIC_UNSUPPORTED_MESSAGE =
  'Las fotos HEIC (iPhone) aún no se pueden leer. Expórtala como JPG o PNG, o cambia la cámara a "Más compatible", e intenta de nuevo.';

/** True when the bytes are an HEIC/HEIF photo (iPhone default). */
export function isHeicBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  return HEIC_BRANDS.includes(buffer.subarray(8, 12).toString('ascii'));
}

/**
 * Vertical strips of an upright image `width × height`. Empty when the image
 * is not tall enough to need them. Strips overlap by {@link STRIP_OVERLAP}; if
 * more than `maxStrips` would be needed they grow so exactly `maxStrips`
 * cover the whole height (nothing is left out).
 */
export function planStrips(
  width: number,
  height: number,
  maxStrips: number = MAX_IMAGE_STRIPS,
): StripBox[] {
  if (!(width > 0) || !(height > 0)) return [];
  if (height / width <= TALL_IMAGE_ASPECT) return [];
  const cap = Math.max(2, Math.floor(maxStrips));

  let stripHeight = Math.round(width * STRIP_ASPECT);
  let count = stripCount(height, stripHeight);
  if (count > cap) {
    // Smallest strip height that covers the image with `cap` strips:
    // H = cap·s − (cap−1)·overlap·s  →  s = H / (cap − (cap−1)·overlap).
    stripHeight = Math.ceil(height / (cap - (cap - 1) * STRIP_OVERLAP));
    count = Math.min(cap, stripCount(height, stripHeight));
  }
  const step = Math.max(1, Math.floor(stripHeight * (1 - STRIP_OVERLAP)));
  const boxes: StripBox[] = [];
  for (let i = 0; i < count; i += 1) {
    const top = i === count - 1 ? Math.max(0, height - stripHeight) : i * step;
    boxes.push({ top, height: Math.min(stripHeight, height - top) });
  }
  return boxes;
}

function stripCount(height: number, stripHeight: number): number {
  if (stripHeight >= height) return 1;
  const step = stripHeight * (1 - STRIP_OVERLAP);
  return Math.ceil((height - stripHeight) / step) + 1;
}

/**
 * Upright (EXIF-rotated) JPEG(s) no larger than `maxEdge`. A very tall photo
 * becomes overlapping strips when `splitTall` is on. Throws
 * {@link ImagePrepError} with a Spanish message; never returns the raw bytes.
 */
export async function prepareImageForAi(
  buffer: Buffer,
  options: ImagePrepOptions = {},
): Promise<PreparedAiImage[]> {
  const maxEdge = options.maxEdge ?? AI_IMAGE_MAX_EDGE;
  const quality = options.quality ?? 85;
  const open = () =>
    sharp(buffer, {
      limitInputPixels: AI_IMAGE_MAX_INPUT_PIXELS,
      animated: false,
    });

  let width: number;
  let height: number;
  try {
    const metadata = await open().metadata();
    if ((metadata.pages ?? 1) > 1) {
      throw new ImagePrepError(
        'multipage',
        'La imagen tiene varias páginas; sube una foto por página o un PDF.',
      );
    }
    if (
      !metadata.width ||
      !metadata.height ||
      !Number.isFinite(metadata.width) ||
      !Number.isFinite(metadata.height)
    ) {
      throw new ImagePrepError('unreadable', 'La imagen tiene dimensiones inválidas.');
    }
    if (metadata.width * metadata.height > AI_IMAGE_MAX_INPUT_PIXELS) {
      throw new ImagePrepError(
        'too_large',
        'La imagen es demasiado grande. Usa una foto de menos de 40 megapíxeles.',
      );
    }
    // Orientations 5–8 swap the axes once the EXIF rotation is applied.
    const swap = (metadata.orientation ?? 1) >= 5;
    width = swap ? metadata.height : metadata.width;
    height = swap ? metadata.width : metadata.height;
  } catch (error) {
    throw toPrepError(error, buffer);
  }

  const boxes = options.splitTall
    ? planStrips(width, height, options.maxStrips)
    : [];
  try {
    if (!boxes.length) {
      const jpeg = await open()
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toBuffer();
      return [{ buffer: jpeg, mime: 'image/jpeg', strip: 1, strips: 1 }];
    }
    // Decode and rotate ONCE; every strip is cut from the upright raw pixels.
    const upright = await open().rotate().raw().toBuffer({ resolveWithObject: true });
    const raw = {
      width: upright.info.width,
      height: upright.info.height,
      channels: upright.info.channels,
    };
    // Planned again on the decoded size, so a box can never leave the image.
    const cuts = planStrips(raw.width, raw.height, options.maxStrips);
    const final = cuts.length ? cuts : [{ top: 0, height: raw.height }];
    const out: PreparedAiImage[] = [];
    for (let i = 0; i < final.length; i += 1) {
      const jpeg = await sharp(upright.data, { raw })
        .extract({ left: 0, top: final[i].top, width: raw.width, height: final[i].height })
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toBuffer();
      out.push({ buffer: jpeg, mime: 'image/jpeg', strip: i + 1, strips: final.length });
    }
    return out;
  } catch (error) {
    throw toPrepError(error, buffer);
  }
}

function toPrepError(error: unknown, buffer: Buffer): ImagePrepError {
  if (error instanceof ImagePrepError) return error;
  if (isHeicBuffer(buffer)) {
    // The prebuilt sharp/libvips only decodes AVIF, not HEVC (HEIC) photos.
    return new ImagePrepError('unsupported', HEIC_UNSUPPORTED_MESSAGE);
  }
  return new ImagePrepError('unreadable', 'No se pudo leer la imagen.');
}
