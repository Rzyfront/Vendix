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

export type ProductReviewBlockReason =
  | 'not_delivered'
  | 'already_reviewed'
  | 'no_customer'
  | 'reviews_disabled';

export interface OrderReviewStatusItem {
  product_id: number;
  product_name: string;
  image_url: string | null;
  can_review: boolean;
  reason: ProductReviewBlockReason | null;
  review: { id: number; rating: number; state: string } | null;
}

export interface OrderReviewStatus {
  order_id: number;
  order_number: string;
  order_state: string;
  can_review_experience: boolean;
  order_review: OrderReview | null;
  items: OrderReviewStatusItem[];
}

export interface CreateOrderReviewDto {
  rating: number;
  quick_tag?: OrderReviewQuickTag;
  comment?: string;
  source?: OrderReviewSource;
}

export interface CreateOrderProductReviewDto {
  product_id: number;
  rating: number;
  title?: string;
  comment: string;
}

export const ORDER_REVIEW_QUICK_TAG_LABELS: Record<OrderReviewQuickTag, string> = {
  very_easy: '¡Fue súper fácil!',
  normal: 'Todo bien, normal',
  difficult: 'Fue difícil comprar',
};
