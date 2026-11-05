import {
  WORKFLOW_EVENT_TOKENS,
  WORKFLOW_INSTANCE_TOKENS,
  WorkflowFieldDef,
  WorkflowTriggerEvent,
  WorkflowVendixActionName,
} from '../../../../../shared/workflows/contract/workflow-contract';

// ─── Triggers and Vendix actions ─────────────────────────────────────

export const TRIGGER_EVENT_LABEL: Record<WorkflowTriggerEvent, string> = {
  'order.created': 'Se crea una orden',
  'order.paid': 'Se paga una orden',
  'purchase_order.received': 'Se recibe una orden de compra',
  'expense.approved': 'Se aprueba un gasto',
  'customer.created': 'Se crea un cliente',
  'pqr.created': 'Se crea una PQR',
};

export const EVENT_TOKEN_LABEL: Record<string, string> = {
  order_id: 'ID de la orden',
  order_number: 'Número de la orden',
  grand_total: 'Total',
  currency: 'Moneda',
  channel: 'Canal',
  payment_id: 'ID del pago',
  purchase_order_id: 'ID de la orden de compra',
  supplier_id: 'ID del proveedor',
  total_amount: 'Monto total',
  expense_id: 'ID del gasto',
  amount: 'Monto',
  category_id: 'ID de la categoría',
  customer_id: 'ID del cliente',
  first_name: 'Nombre',
  last_name: 'Apellido',
  email: 'Correo',
  ticket_id: 'ID del ticket',
  ticket_number: 'Número del ticket',
  title: 'Título',
  description: 'Descripción',
  category: 'Categoría',
  contact_name: 'Nombre de contacto',
  contact_email: 'Correo de contacto',
};

export const VENDIX_ACTION_LABEL: Record<WorkflowVendixActionName, string> = {
  'vendix.purchase_order.create_draft': 'Crear orden de compra en borrador',
  'vendix.crm_task.create': 'Crear tarea CRM',
};

export const ACTION_MAP_KEY_LABEL: Record<string, string> = {
  supplier_id: 'Proveedor (ID)',
  location_id: 'Ubicación de recepción (ID)',
  product_id: 'Producto (ID)',
  quantity: 'Cantidad',
  unit_price: 'Precio unitario',
  notes: 'Notas',
  expected_date: 'Fecha esperada',
  title: 'Título',
  description: 'Descripción',
  due_in_days: 'Vence en (días)',
  assignee: 'Responsable',
};

/** Tokens offered by an action map: declared fields plus the instance ones. */
export function actionTokenOptions(fields: WorkflowFieldDef[]): { value: string; label: string }[] {
  return [
    ...fields.map((f) => ({ value: `{{fields.${f.key}}}`, label: `Campo: ${f.label}` })),
    ...WORKFLOW_INSTANCE_TOKENS.map((t) => ({
      value: `{{${t}}}`,
      label: t === 'instance.reference' ? 'Referencia de la solicitud' : 'Título de la solicitud',
    })),
  ];
}

/** Tokens offered by an event trigger map. */
export function eventTokenOptions(event: WorkflowTriggerEvent): { value: string; label: string }[] {
  return WORKFLOW_EVENT_TOKENS[event].map((t) => ({
    value: `{{event.${t}}}`,
    label: EVENT_TOKEN_LABEL[t] ?? t,
  }));
}
