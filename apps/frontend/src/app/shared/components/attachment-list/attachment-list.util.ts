/** One attachment shown by `app-attachment-list`. */
export interface AttachmentItem {
  name: string;
  size?: number | null;
  mime_type?: string | null;
  /** Signed or public URL; null while it cannot be resolved (legacy rows). */
  url?: string | null;
  /** Storage key, kept so the owner can map a removal back to its value. */
  key?: string;
}

export type AttachmentKind = 'image' | 'pdf' | 'other';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

/** Classifies an attachment by MIME type, falling back to the file extension. */
export function attachmentKind(item: Pick<AttachmentItem, 'name' | 'mime_type'>): AttachmentKind {
  const mime = (item.mime_type ?? '').toLowerCase();
  const ext = extensionOf(item.name ?? '');
  if (mime.startsWith('image/') || (!mime && IMAGE_EXTENSIONS.includes(ext))) return 'image';
  if (mime === 'application/pdf' || (!mime && ext === 'pdf')) return 'pdf';
  return 'other';
}

/** `1536` → `1,5 KB`; unknown or non-positive sizes give an empty string. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace('.', ',');
  return `${text} ${units[unit]}`;
}
