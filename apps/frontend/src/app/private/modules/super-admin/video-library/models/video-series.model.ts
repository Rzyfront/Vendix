export type VideoSeriesStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface VideoSeriesListItem {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  module: string | null;
  status: VideoSeriesStatus;
  _count?: { items: number };
}

export interface VideoSeriesItemDetail {
  id: number;
  video_id: number;
  article_id: number | null;
  position: number;
  video: { id: number; title: string; status: string; duration_seconds: number };
  article: { id: number; title: string; slug: string } | null;
}

export interface VideoSeriesDetail extends VideoSeriesListItem {
  description: string | null;
  items: VideoSeriesItemDetail[];
}

export interface VideoSeriesPayload {
  title?: string;
  summary?: string;
  description?: string;
  module?: string;
  items?: { video_id: number; article_id?: number | null }[];
}
