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
}

export type ReviewState = 'pending' | 'approved' | 'rejected' | 'hidden' | 'flagged';

export interface ReviewResponse {
  id: number;
  review_id: number;
  user_id: number;
  content: string;
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
