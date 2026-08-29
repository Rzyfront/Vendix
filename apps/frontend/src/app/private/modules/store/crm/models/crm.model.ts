export type CrmGenerationStatus =
  | 'idle'
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed';

export interface CrmLandingState {
  enabled: boolean;
  generation_status: CrmGenerationStatus;
  content_json: unknown;
  published_json: unknown;
  published_at: string | null;
  version: number;
}

export interface CrmApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}
