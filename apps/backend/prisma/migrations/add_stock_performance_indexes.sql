-- Migration: Add Performance Indexes for Stock Management
-- Purpose: Optimize queries for the new stock management system

-- Add indexes to stock_levels for better performance
CREATE INDEX IF NOT EXISTS idx_stock_levels_product_location ON stock_levels(product_id, location_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_product ON stock_levels(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_location_available ON stock_levels(location_id, quantity_available);
CREATE INDEX IF NOT EXISTS idx_stock_levels_available_reorder ON stock_levels(quantity_available, reorder_point);

-- Add index for products to improve store-based queries
CREATE INDEX IF NOT EXISTS idx_products_store_state ON products(store_id, state);
CREATE INDEX IF NOT EXISTS idx_products_store_active ON products(store_id) WHERE state = 'active';

-- Add index for inventory locations to improve organization-based queries
CREATE INDEX IF NOT EXISTS idx_inventory_locations_org_active ON inventory_locations(organization_id, is_active);

-- Add partial indexes for common filtered queries
CREATE INDEX IF NOT EXISTS idx_stock_levels_positive_available ON stock_levels(product_id, location_id) WHERE quantity_available > 0;
CREATE INDEX IF NOT EXISTS idx_stock_reservations_active ON stock_reservations(organization_id, product_id, location_id) WHERE status = 'active' AND expires_at > NOW();

-- Analyze tables for better query planning
ANALYZE stock_levels;
ANALYZE products;
ANALYZE inventory_locations;
ANALYZE stock_reservations;

-- Comments explaining the purpose of each index
COMMENT ON INDEX idx_stock_levels_product_location IS 'Optimize stock lookups by product and location';
COMMENT ON INDEX idx_stock_levels_product IS 'Optimize total stock calculations by product';
COMMENT ON INDEX idx_stock_levels_location_available IS 'Optimize finding products with available stock in a location';
COMMENT ON INDEX idx_stock_levels_available_reorder IS 'Optimize low stock alert queries';
COMMENT ON INDEX idx_products_store_state IS 'Optimize product listing by store and state';
COMMENT ON INDEX idx_products_store_active IS 'Optimize active product queries by store';
COMMENT ON INDEX idx_inventory_locations_org_active IS 'Optimize location lookups by organization and active status';
COMMENT ON INDEX idx_stock_levels_positive_available IS 'Optimize queries for products with positive stock';
COMMENT ON INDEX idx_stock_reservations_active IS 'Optimize active reservation lookups';