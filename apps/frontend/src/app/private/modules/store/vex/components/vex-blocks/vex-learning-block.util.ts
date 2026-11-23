import {
  VexLearningPath,
  VexVideoRef,
} from '../../services/vex-media-dock.service';

export interface VexHelpArticleData {
  id: number;
  title: string;
  slug: string;
  summary?: string | null;
  content: string;
  type?: string | null;
  module?: string | null;
  cover_image_url?: string | null;
  video?: VexVideoRef | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The backend validates these payloads; the panel still reads them defensively. */
export function readVideo(value: unknown): VexVideoRef | null {
  if (!isRecord(value)) return null;
  if (typeof value['id'] !== 'number' || typeof value['video_url'] !== 'string') {
    return null;
  }
  return value as unknown as VexVideoRef;
}

export function readArticle(value: unknown): VexHelpArticleData | null {
  if (!isRecord(value)) return null;
  if (typeof value['title'] !== 'string' || typeof value['content'] !== 'string') {
    return null;
  }
  return {
    ...(value as unknown as VexHelpArticleData),
    video: readVideo(value['video']),
  };
}

export function readSeries(value: unknown): VexLearningPath | null {
  if (!isRecord(value) || !Array.isArray(value['items'])) return null;
  const items = value['items'].flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const video = readVideo(raw['video']);
    if (!video || typeof raw['position'] !== 'number') return [];
    return [{ ...(raw as object), video }];
  }) as unknown as VexLearningPath['items'];
  if (typeof value['id'] !== 'number' || typeof value['title'] !== 'string') {
    return null;
  }
  return {
    id: value['id'],
    title: value['title'],
    summary: typeof value['summary'] === 'string' ? value['summary'] : null,
    items,
  };
}
