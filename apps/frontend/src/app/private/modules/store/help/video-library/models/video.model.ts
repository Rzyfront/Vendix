export type VideoSourceType = 'YOUTUBE' | 'VIMEO' | 'LOOM' | 'DIRECT_S3';

export type VideoStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface VideoCategory {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  _count?: {
    videos: number;
  };
}

export interface Video {
  id: number;
  title: string;
  slug: string;
  summary: string;
  description?: string | null;
  video_url: string;
  video_source: VideoSourceType;
  external_id?: string | null;
  duration_seconds: number;
  thumbnail_url?: string | null;
  status: VideoStatus;
  category_id: number;
  module?: string | null;
  tags: string[];
  view_count: number;
  created_by_id?: number | null;
  store_id?: number | null;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  category: {
    id: number;
    name: string;
    slug: string;
    icon?: string | null;
  };
  related_videos?: Video[];
}

export interface VideoStats {
  total: number;
  published: number;
  draft: number;
  total_views: number;
}

export interface VideosResponse {
  data: Video[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface VideoQuery {
  page?: number;
  limit?: number;
  category?: string;
  module?: string;
  search?: string;
}

export interface TimestampBookmark {
  seconds: number;
  label: string;
  formattedTime: string;
}
