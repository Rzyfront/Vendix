#!/bin/bash

# Script para probar APIs de Vendix

echo "🚀 Iniciando pruebas de API de Vendix..."

# 1. Login y obtener token
echo "📝 1. Obteniendo token de autenticación..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "superadmin@vendix.com",
    "password": "1125634q",
    "organization_slug": "vendix-corp"
  }')

echo "Respuesta login: $LOGIN_RESPONSE"

# Extraer token
TOKEN=$(echo "$LOGIN_RESPONSE" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "❌ No se pudo obtener el token"
  exit 1
fi

echo "✅ Token obtenido: ${TOKEN:0:20}..."

# 2. Probar endpoint de productos (GET)
echo "📦 2. Probando GET /api/products..."
PRODUCTS_RESPONSE=$(curl -s -X GET http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-organization-id: 1")

echo "Respuesta productos: $PRODUCTS_RESPONSE"

# 3. Probar crear producto (POST)
echo "🆕 3. Probando POST /api/products..."
CREATE_PRODUCT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-organization-id: 1" \
  -d '{
    "name": "Laptop Gaming Pro",
    "slug": "laptop-gaming-pro",
    "description": "Laptop de alto rendimiento para gaming",
    "base_price": 1299.99,
    "sku": "LP-GAMING-001",
    "stock_quantity": 50,
    "store_id": 1
  }')

echo "Respuesta crear producto: $CREATE_PRODUCT_RESPONSE"

# 4. Probar endpoint de tiendas (GET)
echo "🏪 4. Probando GET /api/stores..."
STORES_RESPONSE=$(curl -s -X GET http://localhost:3000/api/stores \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-organization-id: 1")

echo "Respuesta tiendas: $STORES_RESPONSE"

# 5. Probar endpoint de inventario (GET)
echo "📊 5. Probando GET /api/inventory/stock-levels..."
INVENTORY_RESPONSE=$(curl -s -X GET http://localhost:3000/api/inventory/stock-levels \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-organization-id: 1")

echo "Respuesta inventario: $INVENTORY_RESPONSE"

echo "✅ Pruebas completadas!"