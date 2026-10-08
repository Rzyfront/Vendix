export interface OrderStatsDto {
  total_orders: number;
  total_revenue: number;
  pending_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  refunded_orders: number;
  average_order_value: number;
}
