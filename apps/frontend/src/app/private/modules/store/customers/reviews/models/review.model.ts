export interface Review {
  id: number;
  store_id: number;
  product_id: number;
  user_id: number;
  rating: number;
  title: string | null;
  comment: string;
  state: ReviewState;
  verified_purchase: boolean;
  helpful_count: number;
  report_count: number;
  created_at: string;
  updated_at: string | null;
  users: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  };
  products: {
    id: number;
    name: string;
    image_url: string | null;
  };
  review_responses: ReviewResponse | null;
  review_votes?: ReviewVote[];
  review_reports?: ReviewReport[];
}

export type ReviewState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'hidden'
  | 'flagged';

export interface ReviewResponse {
  id: number;
  review_id: number;
  user_id: number;
  content: string;
  created_at: string;
  updated_at?: string | null;
  users?: {
    id: number;
    first_name: string;
    last_name: string;
  };
}

export interface ReviewVote {
  id: number;
  review_id: number;
  user_id: number;
  is_helpful: boolean;
  created_at: string;
  users?: {
    id: number;
    first_name: string;
    last_name: string;
  };
}

export interface ReviewReport {
  id: number;
  review_id: number;
  user_id: number;
  reason: string;
  status?: string;
  created_at: string;
  users?: {
    id: number;
    first_name: string;
    last_name: string;
  };
}

export interface ReviewStats {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  flagged_count: number;
  average_rating: number | null;
}

export interface ReviewFilters {
  search?: string;
  state?: ReviewState;
  rating?: number;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

// ── Experiencia de compra (reseña de la orden) ──────────────────────────────
export type OrderReviewQuickTag = 'very_easy' | 'normal' | 'difficult';
export type OrderReviewSource = 'order_confirmation' | 'order_detail';

export interface OrderReview {
  id: number;
  order_id: number;
  rating: number;
  quick_tag: OrderReviewQuickTag | null;
  comment: string | null;
  source: OrderReviewSource;
  created_at: string;
}

export interface AdminOrderReview extends OrderReview {
  order_number: string;
  customer_name: string | null;
}

export interface OrderReviewFilters {
  page?: number;
  limit?: number;
  rating?: number;
  quick_tag?: OrderReviewQuickTag;
  date_from?: string;
  date_to?: string;
}

export const ORDER_REVIEW_QUICK_TAG_LABELS: Record<OrderReviewQuickTag, string> = {
  very_easy: 'Fue súper fácil',
  normal: 'Todo normal',
  difficult: 'Fue difícil',
};

export const ORDER_REVIEW_SOURCE_LABELS: Record<OrderReviewSource, string> = {
  order_confirmation: 'Al confirmar el pedido',
  order_detail: 'Desde el detalle del pedido',
};
