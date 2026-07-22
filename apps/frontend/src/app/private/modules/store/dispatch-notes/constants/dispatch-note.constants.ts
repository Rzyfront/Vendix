import {
  DispatchNoteStatus,
  DispatchNoteDirection,
  DispatchNoteSubtype,
  DispatchNoteReason,
} from '../interfaces/dispatch-note.interface';

export const STATUS_LABELS: Record<DispatchNoteStatus, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  delivered: 'Entregada',
  received: 'Recibida',
  invoiced: 'Facturada',
  voided: 'Anulada',
};

export const STATUS_COLORS: Record<DispatchNoteStatus, string> = {
  draft: '#6b7280',
  confirmed: '#3b82f6',
  delivered: '#10b981',
  received: '#0ea5e9',
  invoiced: '#8b5cf6',
  voided: '#ef4444',
};

export const STATUS_BG_CLASSES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  confirmed: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  received: 'bg-sky-100 text-sky-800',
  invoiced: 'bg-purple-100 text-purple-800',
  voided: 'bg-red-100 text-red-800',
};

// ============================================================================
// Bidirectional labels — direction / subtype / reason
// (ref plan Remisiones Bidireccionales, Fase 3 frontend cimiento)
// ============================================================================

export const DIRECTION_LABELS: Record<DispatchNoteDirection, string> = {
  outbound: 'Salida',
  inbound: 'Entrada',
};

export const DIRECTION_DESCRIPTIONS: Record<DispatchNoteDirection, string> = {
  outbound: 'Mercancía que sale del inventario (entrega, traslado, etc.)',
  inbound: 'Mercancía que entra al inventario (devolución, recepción, etc.)',
};

export const SUBTYPE_LABELS: Record<DispatchNoteSubtype, string> = {
  customer_delivery: 'Entrega a cliente',
  customer_return: 'Devolución de cliente',
  transfer_out: 'Traslado saliente',
  transfer_in: 'Traslado entrante',
  purchase_receipt: 'Recepción de compra',
};

export const SUBTYPE_DESCRIPTIONS: Record<DispatchNoteSubtype, string> = {
  customer_delivery: 'Despacho de mercancía al cliente',
  customer_return: 'Reingreso por devolución del cliente',
  transfer_out: 'Traslado de stock a otra tienda',
  transfer_in: 'Recepción de stock desde otra tienda',
  purchase_receipt: 'Ingreso por recepción de orden de compra',
};

export const SUBTYPE_COLORS: Record<DispatchNoteSubtype, string> = {
  customer_delivery: '#3b82f6',
  customer_return: '#f59e0b',
  transfer_out: '#8b5cf6',
  transfer_in: '#6366f1',
  purchase_receipt: '#0ea5e9',
};

export const SUBTYPE_BG_CLASSES: Record<DispatchNoteSubtype, string> = {
  customer_delivery: 'bg-blue-100 text-blue-800',
  customer_return: 'bg-amber-100 text-amber-800',
  transfer_out: 'bg-purple-100 text-purple-800',
  transfer_in: 'bg-indigo-100 text-indigo-800',
  purchase_receipt: 'bg-sky-100 text-sky-800',
};

export const REASON_LABELS: Record<DispatchNoteReason, string> = {
  // outbound — customer_delivery
  sale: 'Venta',
  sample: 'Muestra',
  consignment: 'Consignación',
  replacement_shipment: 'Envío de reposición',
  loan: 'Préstamo',
  // outbound — transfer_out
  transfer_to_consignee: 'Traslado a consignatario',
  // inbound — customer_return
  defective: 'Producto defectuoso',
  wrong_item: 'Producto equivocado',
  cancellation: 'Cancelación',
  warranty: 'Garantía',
  overdelivery_return: 'Devolución por sobre-entrega',
  // inbound — transfer_in
  returned_from_consignee: 'Retorno de consignatario',
  // shared — transfer_out / transfer_in
  replenishment: 'Reabastecimiento',
  rebalancing: 'Rebalanceo',
  // inbound — purchase_receipt
  normal_purchase: 'Compra normal',
  replacement_for_damage: 'Reposición por daño',
  sample_received: 'Muestra recibida',
};
