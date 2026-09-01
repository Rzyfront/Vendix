import { IsString, IsBoolean, IsOptional, IsIn } from 'class-validator';

const NOTIFICATION_TYPES = [
  'new_order',
  'order_status_change',
  'low_stock',
  'new_customer',
  'payment_received',
  'layaway_payment_received',
  'layaway_payment_reminder',
  'layaway_overdue',
  'layaway_completed',
  'layaway_cancelled',
  'new_review',
  // QUI-647 — vencimientos de CxP: el usuario puede apagar/encender la campana
  // y el web push de cada tipo desde Configuración → Notificaciones.
  'ap_installment_due_soon',
  'ap_installment_overdue',
  // T9 — listo de cocina: el mesero puede apagar/encender la campana
  // desde Configuración → Notificaciones, igual que el resto.
  'kitchen_ticket_ready',
] as const;

export class UpdateSubscriptionDto {
  @IsString()
  @IsIn(NOTIFICATION_TYPES)
  type: string;

  @IsOptional()
  @IsBoolean()
  in_app?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

export class BulkUpdateSubscriptionsDto {
  subscriptions: UpdateSubscriptionDto[];
}
