import type { AttachmentItem } from '../../../../../shared/components/attachment-list/attachment-list.util';

/** Shape of a file field's response as the submission detail returns it. */
export interface FileResponseLike {
  value_text?: string | null;
  files?: { key?: string; name?: string; size?: number | null; mime_type?: string | null; url?: string | null }[] | null;
}

function basename(path: string): string {
  const clean = path.split('?')[0];
  return clean.split('/').filter(Boolean).pop() ?? clean;
}

/**
 * Attachments of one file response. Prefers `files` (new shape); legacy rows
 * only carry `value_text` (an http URL or a storage key whose presigned URL,
 * when resolved, comes in `resolvedUrl`).
 */
export function responseAttachments(response: FileResponseLike, resolvedUrl?: string | null): AttachmentItem[] {
  if (response.files?.length) {
    return response.files.map((f) => ({
      key: f.key,
      name: f.name || basename(f.key ?? '') || 'Archivo',
      size: f.size ?? null,
      mime_type: f.mime_type ?? null,
      url: f.url ?? null,
    }));
  }
  const text = response.value_text ?? '';
  if (text.startsWith('http')) return [{ name: basename(text) || 'Archivo', url: text }];
  if (text.startsWith('organizations/')) {
    return [{ key: text, name: basename(text), url: resolvedUrl ?? null }];
  }
  return [];
}
