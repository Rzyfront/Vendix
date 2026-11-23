/**
 * AI_ATTACHMENTS — the single list of files Vex and Vexi accept in the chat
 * (odd/tasks/vex-agente-avanzado.md §1.7, T41, S7): the same types and the same
 * size limit on screen and on the server.
 *
 * Canonical source. Same pattern as `ai-capabilities.ts`: it lives in
 * `libs/shared-types` and is copied BYTE FOR BYTE to the two runtimes, because
 * no executable package is shared between Nest and Angular:
 *
 *   - apps/backend/src/domains/store/vexi/ai-attachments.ts
 *   - apps/frontend/src/app/shared/constants/ai-attachments.ts
 *
 * `apps/backend/src/domains/store/vexi/ai-attachments.spec.ts` fails if any
 * copy drifts. Edit this file, then copy it over both mirrors.
 *
 * Pure data + pure functions: no imports, no runtime dependencies.
 */

/** 10 MB: what the vision scanners downstream accept. */
export const AI_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const AI_ATTACHMENT_MAX_FILES = 5;

export type AIAttachmentKind = 'image' | 'pdf' | 'table' | 'text';

export interface AIAttachmentType {
  mime: string;
  extensions: readonly string[];
  kind: AIAttachmentKind;
}

export const AI_ATTACHMENT_TYPES: readonly AIAttachmentType[] = [
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], kind: 'image' },
  { mime: 'image/png', extensions: ['png'], kind: 'image' },
  { mime: 'image/webp', extensions: ['webp'], kind: 'image' },
  { mime: 'image/heic', extensions: ['heic'], kind: 'image' },
  { mime: 'image/heif', extensions: ['heif'], kind: 'image' },
  { mime: 'application/pdf', extensions: ['pdf'], kind: 'pdf' },
  { mime: 'text/csv', extensions: ['csv'], kind: 'table' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    kind: 'table',
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    kind: 'text',
  },
  { mime: 'text/plain', extensions: ['txt'], kind: 'text' },
];

/** Human label (Spanish) of what is accepted, for messages and hints. */
export const AI_ATTACHMENT_LABEL =
  'Fotos (JPG, PNG, WEBP, HEIC), PDF, Excel (XLSX), CSV, Word (DOCX) y TXT';

/** MIME values browsers send when they do not know the real type. */
const GENERIC_MIMES = [
  '',
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/csv',
  'text/x-csv',
  'text/comma-separated-values',
  'application/x-csv',
];

function extensionOf(fileName: string): string {
  const name = String(fileName ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).trim() : '';
}

/**
 * Resolves the accepted type of a file, or null when it is not accepted.
 * A known MIME wins; a generic or empty MIME (CSV often arrives as
 * `application/vnd.ms-excel` or empty) falls back to the extension. `image/jpg`
 * is treated as `image/jpeg`.
 */
export function resolveAttachmentType(
  mime: string | null | undefined,
  fileName: string,
): AIAttachmentType | null {
  const normalized = String(mime ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  const canonical = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  const byMime = AI_ATTACHMENT_TYPES.find((t) => t.mime === canonical);
  if (byMime) return byMime;
  if (!GENERIC_MIMES.includes(canonical)) return null;
  const ext = extensionOf(fileName);
  if (!ext) return null;
  return AI_ATTACHMENT_TYPES.find((t) => t.extensions.includes(ext)) ?? null;
}

/** Value for `<input type="file" accept>`. */
export function acceptAttribute(): string {
  const parts: string[] = [];
  for (const type of AI_ATTACHMENT_TYPES) {
    parts.push(type.mime);
    for (const ext of type.extensions) parts.push(`.${ext}`);
  }
  return parts.join(',');
}
