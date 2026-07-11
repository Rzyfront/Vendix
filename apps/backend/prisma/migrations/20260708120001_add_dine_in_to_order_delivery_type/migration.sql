-- DATA IMPACT: Non-destructive. Adds enum value 'dine_in' to order_delivery_type_enum. No existing rows modified.
ALTER TYPE "order_delivery_type_enum" ADD VALUE IF NOT EXISTS 'dine_in';