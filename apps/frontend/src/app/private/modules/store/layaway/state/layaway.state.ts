import { LayawayPlan, LayawayStats } from '../interfaces/layaway.interface';

export interface LayawayState {
  layaways: LayawayPlan[];
  layaway_loading: boolean;
  stats: LayawayStats | null;
  stats_loading: boolean;
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  } | null;
  error: string | null;
  search: string;
  page: number;
  limit: number;
  sort_by: string;
  sort_order: 'asc' | 'desc';
  state_filter: string | null;
}

export const INITIAL_LAYAWAY_STATE: LayawayState = {
  layaways: [],
  layaway_loading: false,
  stats: null,
  stats_loading: false,
  meta: null,
  error: null,
  search: '',
  page: 1,
  limit: 10,
  sort_by: 'created_at',
  sort_order: 'desc',
  state_filter: null,
};
