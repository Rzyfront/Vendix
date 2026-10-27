/** Hospitality Suite (H0.2) — room type as returned by the store API. */
export interface UnitType {
  id: number;
  product_id: number;
  name: string;
  code: string | null;
  description: string | null;
  base_occupancy: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  bed_config: string | null;
  /** H0.4 — S3 keys of the photos in display order. */
  images: string[];
  /** H0.4 — signed URLs of `images`, same order. */
  image_urls: string[];
  /** H0.4 — codes from the amenities catalog. */
  amenities: string[];
  overbooking_allowance: number;
  sort_order: number;
  is_active: boolean;
  /** Owned service product "Noche – {name}": nightly price and its tax. */
  product: {
    id: number;
    name: string;
    base_price: string | number;
    state: string;
    product_tax_assignments: { tax_categories: { id: number; name: string } }[];
  };
  /** H0.3 — active rooms of the type (sellable inventory). */
  _count?: { units: number };
}

export interface UnitTypePayload {
  name: string;
  code?: string;
  description?: string;
  base_occupancy: number;
  max_adults: number;
  max_children: number;
  bed_config?: string;
  base_price: number;
  tax_category_ids: number[];
  images?: string[];
  amenities?: string[];
  is_active?: boolean;
}

/** H0.4 — entry of `GET /store/hospitality/unit-types/amenities`. */
export interface LodgingAmenity {
  code: string;
  label: string;
}
