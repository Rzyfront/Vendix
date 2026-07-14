/**
 * Restaurant Suite — Fase G.
 * Source of truth for the Menus / Carta domain in the frontend.
 *
 * Mirrors the Prisma models `menus`, `menu_sections`, `menu_section_items`
 * and `menu_availability_windows` plus the DTO contracts exposed by
 * `apps/backend/src/domains/store/menus`.
 */

export interface Menu {
  id: number;
  store_id: number;
  name: string;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  _count?: { sections: number; availability_windows: number };
}

export interface MenuSection {
  id: number;
  menu_id: number;
  store_id: number;
  name: string;
  sort_order: number;
  created_at?: string | Date;
  updated_at?: string | Date;
  _count?: { items: number };
  items?: MenuSectionItem[];
  availability_windows?: AvailabilityWindow[];
}

export interface MenuSectionItem {
  id: number;
  menu_section_id: number;
  product_id: number;
  sort_order: number;
  created_at?: string | Date;
  updated_at?: string | Date;
  product?: {
    id: number;
    name: string;
    image_url?: string | null;
    sku?: string | null;
    base_price?: number | string | null;
    is_sellable?: boolean;
    is_combo?: boolean;
    state?: string;
    stock_unit?: string | null;
  };
}

export interface AvailabilityWindow {
  id: number;
  store_id: number;
  menu_id: number | null;
  menu_section_id: number | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface MenuFull extends Menu {
  sections: MenuSection[];
  availability_windows: AvailabilityWindow[];
}

export type EngineeringQuadrant = 'estrella' | 'caballo' | 'puzzle' | 'perro';

export interface EngineeringProduct {
  product_id: number;
  product_name: string;
  sku: string | null;
  base_price: number;
  recipe_unit_cost: number;
  units_sold: number;
  revenue: number;
  profit: number;
  margin_pct: number;
  popularity_pct: number;
  quadrant: EngineeringQuadrant;
  has_recipe: boolean;
}

export interface MenuEngineeringReport {
  from: string;
  to: string;
  total_products: number;
  totals: { units_sold: number; revenue: number; profit: number };
  thresholds: { popularity_median: number; margin_median: number };
  counts: Record<EngineeringQuadrant, number>;
  groups: Record<EngineeringQuadrant, EngineeringProduct[]>;
}

export interface CreateMenuDto {
  name: string;
  is_active?: boolean;
}

export type UpdateMenuDto = Partial<CreateMenuDto>;

export interface MenuQuery {
  page?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
}

export interface CreateMenuSectionDto {
  name: string;
  sort_order?: number;
}

export type UpdateMenuSectionDto = Partial<CreateMenuSectionDto>;

export interface AddMenuSectionItemDto {
  product_id: number;
  sort_order?: number;
}

export interface CreateAvailabilityWindowDto {
  day_of_week: number;
  start_time: string;
  end_time: string;
  menu_section_id?: number;
}

export type UpdateAvailabilityWindowDto = Partial<CreateAvailabilityWindowDto>;

export interface MenuStats {
  total_menus: number;
  active_menus: number;
  total_sections: number;
  total_section_items: number;
}
