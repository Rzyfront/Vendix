/**
 * Provisional TS mirror of the dispatch_note direction/subtype/reason enums.
 *
 * These types exist because the Prisma client has not yet been regenerated
 * after the migration `add_dispatch_note_direction_subtype`. Once the client
 * is regenerated, replace references to these types with the Prisma-generated
 * enums (e.g. `Prisma.dispatch_note_direction_enum`).
 *
 * Values MUST stay in sync with the enums defined in schema.prisma.
 */

export type DispatchNoteDirection = 'outbound' | 'inbound';

export type DispatchNoteSubtype =
  | 'customer_delivery'
  | 'customer_return'
  | 'transfer_out'
  | 'transfer_in'
  | 'purchase_receipt';

export type DispatchNoteReason =
  | 'sale'
  | 'sample'
  | 'consignment'
  | 'replacement_shipment'
  | 'loan'
  | 'defective'
  | 'wrong_item'
  | 'cancellation'
  | 'warranty'
  | 'overdelivery_return'
  | 'replenishment'
  | 'rebalancing'
  | 'transfer_to_consignee'
  | 'returned_from_consignee'
  | 'normal_purchase'
  | 'replacement_for_damage'
  | 'sample_received';

/** Extended status enum including the new 'received' state for inbound notes. */
export type DispatchNoteStatus =
  | 'draft'
  | 'confirmed'
  | 'delivered'
  | 'received'
  | 'invoiced'
  | 'voided';

/** Valid subtypes per direction (service-layer validation uses this map). */
export const VALID_SUBTYPES_BY_DIRECTION: Record<
  DispatchNoteDirection,
  DispatchNoteSubtype[]
> = {
  outbound: ['customer_delivery', 'transfer_out'],
  inbound: ['customer_return', 'transfer_in', 'purchase_receipt'],
};

/** Valid reasons per subtype (service-layer validation uses this map). */
export const VALID_REASONS_BY_SUBTYPE: Partial<
  Record<DispatchNoteSubtype, DispatchNoteReason[]>
> = {
  customer_delivery: [
    'sale',
    'sample',
    'consignment',
    'replacement_shipment',
    'loan',
  ],
  transfer_out: ['replenishment', 'rebalancing', 'transfer_to_consignee'],
  customer_return: [
    'defective',
    'wrong_item',
    'cancellation',
    'warranty',
    'overdelivery_return',
  ],
  transfer_in: ['replenishment', 'rebalancing', 'returned_from_consignee'],
  purchase_receipt: ['normal_purchase', 'replacement_for_damage', 'sample_received'],
};