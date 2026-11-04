/**
 * F6-A — preview protocol of the page builder.
 *
 * The preview is a same-origin iframe that renders the app's PUBLIC page
 * component at a real viewport width (390 px phone, 1280 px desktop), so the
 * Tailwind breakpoints the public page uses behave exactly as published. The
 * editor posts the draft to the frame on every change; the frame posts back
 * when it is ready and when the owner clicks a section.
 *
 * Every message carries `channel` and is only accepted from the same origin
 * (and, in the frame, only from its parent window).
 */
export const BUILDER_PREVIEW_CHANNEL = 'vendix-page-builder-preview';

/** Real viewport widths of each preview device. */
export const BUILDER_DEVICE_WIDTH = { mobile: 390, desktop: 1280 } as const;

export interface BuilderPreviewRender<TPayload = unknown> {
  channel: typeof BUILDER_PREVIEW_CHANNEL;
  type: 'render';
  payload: TPayload;
  selectedBlockId: string | null;
}

export interface BuilderPreviewReady {
  channel: typeof BUILDER_PREVIEW_CHANNEL;
  type: 'ready';
}

export interface BuilderPreviewSelect {
  channel: typeof BUILDER_PREVIEW_CHANNEL;
  type: 'select';
  blockId: string;
}

export type BuilderPreviewToHost = BuilderPreviewReady | BuilderPreviewSelect;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A message the frame sends to the editor, or `null` for anything else. */
export function readHostMessage(event: MessageEvent, origin: string): BuilderPreviewToHost | null {
  const data = event.data;
  if (event.origin !== origin || !isObject(data) || data['channel'] !== BUILDER_PREVIEW_CHANNEL) return null;
  if (data['type'] === 'ready') return { channel: BUILDER_PREVIEW_CHANNEL, type: 'ready' };
  if (data['type'] === 'select' && typeof data['blockId'] === 'string') {
    return { channel: BUILDER_PREVIEW_CHANNEL, type: 'select', blockId: data['blockId'] };
  }
  return null;
}

/** A render message the editor sends to the frame, or `null` for anything else. */
export function readFrameMessage<TPayload>(
  event: MessageEvent,
  origin: string,
  parent: Window | null,
): BuilderPreviewRender<TPayload> | null {
  const data = event.data;
  if (event.origin !== origin || (parent && event.source !== parent)) return null;
  if (!isObject(data) || data['channel'] !== BUILDER_PREVIEW_CHANNEL || data['type'] !== 'render') return null;
  return data as unknown as BuilderPreviewRender<TPayload>;
}

/**
 * Scale that fits a `deviceWidth` viewport into a pane `available` pixels
 * wide (never enlarges).
 */
export function previewScale(available: number, deviceWidth: number): number {
  if (!(available > 0)) return 1;
  return Math.min(1, available / deviceWidth);
}
