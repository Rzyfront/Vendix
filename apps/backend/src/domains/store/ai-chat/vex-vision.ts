import type { AIMessageContentPart } from '../../../ai-engine/interfaces/ai-provider.interface';
import { AI_ATTACHMENT_MAX_FILES } from '../vexi/ai-attachments';

/**
 * Native vision for Vex (T42, S7). The current turn's images travel to the
 * model as `image_url` parts when, and only when, the resolved AI config
 * declares `settings.supports_vision === true`. Everything else (flag absent
 * or false, PDFs, tables, HEIC) keeps the handle + `ai_extract_document` path.
 *
 * Serialization: each part carries a short-lived presigned S3 URL (15 min),
 * not a data URI. A data URI of up to 5 x 10 MB would bloat every ReAct
 * iteration's request and log row; OpenAI-compatible providers pass
 * `image_url` through as is and the Anthropic adapter maps it to a `url`
 * source (and to `base64` if a `data:` URI is ever supplied).
 */

/** Mimes every provider decodes natively. HEIC/HEIF go through OCR instead. */
export const VISION_IMAGE_MIMES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export const VISION_URL_TTL_SECONDS = 900;

export function configSupportsVision(settings: unknown): boolean {
  return (
    !!settings &&
    typeof settings === 'object' &&
    (settings as Record<string, unknown>).supports_vision === true
  );
}

export interface VisionAttachmentsPort {
  describeMany(handles: string[]): Promise<
    Array<{ attachment_id: string; original_name: string; mime_type: string }>
  >;
  signedUrl(handle: string, expiresIn?: number): Promise<string>;
}

export async function buildVisionImageParts(
  attachments: VisionAttachmentsPort,
  handles: string[] | undefined,
): Promise<AIMessageContentPart[]> {
  if (!handles?.length) return [];
  const described = await attachments.describeMany(handles);
  const images = described
    .filter((a) => VISION_IMAGE_MIMES.includes(a.mime_type.toLowerCase()))
    .slice(0, AI_ATTACHMENT_MAX_FILES);
  return Promise.all(
    images.map(async (a) => ({
      type: 'image_url' as const,
      image_url: {
        url: await attachments.signedUrl(
          a.attachment_id,
          VISION_URL_TTL_SECONDS,
        ),
        detail: 'auto' as const,
      },
    })),
  );
}
