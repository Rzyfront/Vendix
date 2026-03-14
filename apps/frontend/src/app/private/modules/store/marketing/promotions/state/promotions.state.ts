import { Promotion, PromotionsSummary } from '../interfaces/promotion.interface';

export interface PromotionsState {
  promotions: Promotion[];
  promotions_loading: boolean;
  current_promotion: Promotion | null;
  current_promotion_loading: boolean;
  promotions_meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
  summary: PromotionsSummary | null;
  summary_loading: boolean;
  error: string | null;
  // Filters
  search: string;
  page: number;
  limit: number;
  sort_by: string;
  sort_order: 'asc' | 'desc';
  state_filter: string;
  type_filter: string;
  scope_filter: string;
}

export const initialPromotionsState: PromotionsState = {
  promotions: [],
  promotions_loading: false,
  current_promotion: null,
  current_promotion_loading: false,
  promotions_meta: { total: 0, page: 1, limit: 10, total_pages: 0 },
  summary: null,
  summary_loading: false,
  error: null,
  search: '',
  page: 1,
  limit: 10,
  sort_by: 'created_at',
  sort_order: 'desc',
  state_filter: '',
  type_filter: '',
  scope_filter: '',
};
