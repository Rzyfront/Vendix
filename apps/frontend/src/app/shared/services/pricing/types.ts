export interface ProductLike {
  id: string;
  base_price: number;
  is_on_sale: boolean;
  sale_price: number | null;
  track_inventory: boolean;
  product_variants?: VariantLike[];
}

export interface VariantLike {
  id: string;
  price_override: number | null;
  is_on_sale: boolean;
  sale_price: number | null;
  track_inventory_override: boolean | null;
}

export interface PriceResolution {
  unitBasePrice: number;
  unitPrice: number;
  unitPriceWithTax: number;
  compareAtPrice: number | null;
  isOnSale: boolean;
  totalTaxRate: number;
  currency: string;
  source: 'variant' | 'product' | 'base';
  reason: string;
}
