import { isSafeS3Key, extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Hospitality Suite (H0.4) — amenities a room type can offer. Codes are
 * persisted; labels are what staff and guests see. Extend the list here.
 */
export const LODGING_AMENITIES = [
  { code: 'wifi', label: 'Wifi' },
  { code: 'air_conditioning', label: 'Aire acondicionado' },
  { code: 'fan', label: 'Ventilador' },
  { code: 'private_bathroom', label: 'Baño privado' },
  { code: 'hot_water', label: 'Agua caliente' },
  { code: 'tv', label: 'Televisión' },
  { code: 'minibar', label: 'Minibar' },
  { code: 'safe', label: 'Caja fuerte' },
  { code: 'desk', label: 'Escritorio' },
  { code: 'balcony', label: 'Balcón' },
  { code: 'kitchenette', label: 'Cocineta' },
  { code: 'parking', label: 'Parqueadero' },
] as const;

export const LODGING_AMENITY_CODES: string[] = LODGING_AMENITIES.map(
  (a) => a.code,
);

export const MAX_UNIT_TYPE_IMAGES = 20;

/**
 * Normalizes room type photo keys before saving: accepts a key or an S3 URL,
 * stores the key, and only allows keys under this store's lodging folder
 * (`organizations/{slug}-{org_id}/stores/{slug}-{store_id}/lodging/...`), so a
 * crafted key cannot make the API sign another tenant's file.
 */
export function normalizeLodgingImageKeys(
  values: string[],
  ctx: { organization_id: number; store_id: number },
): string[] {
  const prefix = new RegExp(
    `^organizations/[^/]+-${ctx.organization_id}/stores/[^/]+-${ctx.store_id}/lodging/[^/]+$`,
  );
  return values.map((value) => {
    const key = extractS3KeyFromUrl(value);
    if (!key || !isSafeS3Key(key) || !prefix.test(key)) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_IMAGE_001);
    }
    return key;
  });
}
