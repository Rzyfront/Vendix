import { shipping_method_type_enum } from '@prisma/client';

const PICKUP_TYPES: shipping_method_type_enum[] = [
  shipping_method_type_enum.pickup,
];

const DELIVERY_TYPES: shipping_method_type_enum[] = [
  shipping_method_type_enum.own_fleet,
  shipping_method_type_enum.carrier,
  shipping_method_type_enum.third_party_provider,
];

export function deriveDeliveryType(
  methodType: shipping_method_type_enum,
): 'pickup' | 'home_delivery' | 'other' {
  if (PICKUP_TYPES.includes(methodType)) return 'pickup';
  if (DELIVERY_TYPES.includes(methodType)) return 'home_delivery';
  return 'other';
}
