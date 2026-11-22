import { VideoSourceType } from '../../video-library/models/video.model';

export interface LearningPathSummary {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  module: string | null;
  thumbnail_url: string | null;
  video_count: number;
  completed_count: number;
}

export interface LearningPathVideo {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  video_url: string;
  video_source: VideoSourceType;
  external_id: string | null;
  duration_seconds: number;
  thumbnail_url: string | null;
}

export interface LearningPathItem {
  position: number;
  video: LearningPathVideo;
  article: { id: number; title: string; slug: string; summary: string | null } | null;
  progress: { seconds_watched: number; completed: boolean } | null;
}

export interface LearningPathDetail {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  items: LearningPathItem[];
}

export interface LearningProgressPayload {
  video_id: number;
  series_id?: number;
  seconds_watched: number;
  completed?: boolean;
}
