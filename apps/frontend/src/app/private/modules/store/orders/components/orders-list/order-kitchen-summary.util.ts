import { OrderItem } from '../../interfaces/order.interface';

export type OrderKitchenStatus =
  | 'pending'
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export interface OrderKitchenSummary {
  eligibleItems: OrderItem[];
  pendingItemIds: number[];
  pendingQuantity: number;
  totalQuantity: number;
  completedQuantity: number;
  status: OrderKitchenStatus | null;
}

const ACTIVE_STATUSES = new Set<OrderKitchenStatus>([
  'pending',
  'in_preparation',
  'ready',
]);
const BOTTLENECK_RANK: Record<OrderKitchenStatus, number> = {
  pending: 0,
  in_preparation: 1,
  cancelled: 2,
  ready: 3,
  delivered: 4,
};

/** Mirrors order detail eligibility and KDS attempt selection. */
export function summarizeOrderKitchen(items: OrderItem[] = []): OrderKitchenSummary {
  const eligibleItems = items.filter(
    (item) =>
      item.product_id != null &&
      item.skip_kds !== true &&
      item.cancelled_at == null &&
      item.products?.product_type === 'prepared',
  );
  const pendingItemIds: number[] = [];
  let totalQuantity = 0;
  let pendingQuantity = 0;
  let completedQuantity = 0;
  const statuses: OrderKitchenStatus[] = [];

  for (const item of eligibleItems) {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    totalQuantity += quantity;
    const attempts = item.kitchen_ticket_items ?? [];
    const activeAttempt = attempts.find((attempt) =>
      ACTIVE_STATUSES.has(attempt.status as OrderKitchenStatus),
    );
    const latestAttempt = activeAttempt ?? attempts[0];
    const isUnfired =
      item.inventory_consumed_at_fire !== true && attempts.length === 0;

    if (isUnfired) {
      pendingItemIds.push(item.id);
      pendingQuantity += quantity;
      statuses.push('pending');
      continue;
    }

    const status = latestAttempt?.status as OrderKitchenStatus | undefined;
    if (!status) {
      // A consumed line without a ticket is inconsistent; keep it visible as
      // attention required instead of presenting a false green state.
      statuses.push('cancelled');
      continue;
    }
    statuses.push(status);
    if (status === 'ready' || status === 'delivered') completedQuantity += quantity;
  }

  const status = statuses.length
    ? statuses.reduce((slowest, current) =>
        BOTTLENECK_RANK[current] < BOTTLENECK_RANK[slowest] ? current : slowest,
      )
    : null;

  return { eligibleItems, pendingItemIds, pendingQuantity, totalQuantity, completedQuantity, status };
}

export function kitchenProgressLabel(summary: OrderKitchenSummary): string {
  if (summary.totalQuantity === 0) return 'Sin platos preparados';
  return `${summary.completedQuantity}/${summary.totalQuantity} platos listos`;
}

export function kitchenStatusLabel(status: OrderKitchenStatus | null): string {
  switch (status) {
    case 'pending': return 'pendiente';
    case 'in_preparation': return 'en preparación';
    case 'ready': return 'listo';
    case 'delivered': return 'entregado';
    case 'cancelled': return 'requiere atención';
    default: return 'sin enviar';
  }
}
