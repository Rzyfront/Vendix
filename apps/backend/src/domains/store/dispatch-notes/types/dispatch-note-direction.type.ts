/**
 * Dispatch note direction/subtype/reason type aliases + validation maps.
 *
 * The Prisma client has been regenerated (migration 20260715204934) so the
 * enum types are now imported from @prisma/client directly. This file keeps
 * the cross-field validation maps (VALID_SUBTYPES_BY_DIRECTION and
 * VALID_REASONS_BY_SUBTYPE) that the service layer uses for invariant checks
 * post-lookup (per vendix-validation: cross-field invariants live in the
 * service, not in the DTO).
 */

import type {
  dispatch_note_direction_enum,
  dispatch_note_subtype_enum,
  dispatch_note_reason_enum,
  dispatch_note_status_enum,
} from '@prisma/client';

export type DispatchNoteDirection = dispatch_note_direction_enum;
export type DispatchNoteSubtype = dispatch_note_subtype_enum;
export type DispatchNoteReason = dispatch_note_reason_enum;
export type DispatchNoteStatus = dispatch_note_status_enum;

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
  purchase_receipt: [
    'normal_purchase',
    'replacement_for_damage',
    'sample_received',
  ],
};