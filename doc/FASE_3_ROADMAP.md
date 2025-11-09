# Ruta de Desarrollo - Fase 3: Sistema de Inventario y Órdenes Corporativo

## **Checklist de Desarrollo Modular**

### **FASE 1: Estructura de Datos - Sistema de Inventario (Semana 1-2)**

#### **✅ 1.1 Modificaciones Schema Prisma - Inventario**

- [x] **Análisis de schema actual** vs requerimientos de inventario completo
- [x] **Diseñar tablas de inventario** según modelo multi-tenant:
  ```
  inventory_locations, stock_levels, inventory_movements
  inventory_batches, inventory_serial_numbers, suppliers
  supplier_products, inventory_adjustments, stock_reservations
  ```
- [x] **Definir enums** para tipos de ubicación, movimientos, ajustes
- [x] **Establecer relaciones** multi-tenant con herencia de organization_id
- [x] **Crear migración** Prisma para tablas de inventario
- [ ] **Actualizar seeds** con datos de prueba de inventario

#### **✅ 1.2 Estructura Backend - Inventario**

- [x] **Crear módulo principal** `inventory/`
- [x] **Estructura modular interna**:
  ```
  inventory/
  ├── locations/
  ├── stock-levels/
  ├── movements/
  ├── batches/
  ├── serial-numbers/
  ├── suppliers/
  ├── adjustments/
  ├── reservations/
  └── shared/
  ```

### **FASE 2: Sistema de Órdenes Corporativo (Semana 3-4)**

#### **✅ 2.1 Modificaciones Schema Prisma - Órdenes**

- [x] **Diseñar tablas de órdenes** según modelo corporativo:
  ```
  purchase_orders, purchase_order_items
  sales_orders, sales_order_items
  stock_transfers, stock_transfer_items
  return_orders, return_order_items
  ```
- [x] **Definir enums** para status de órdenes corporativas
- [x] **Establecer relaciones** con inventario y multi-tenant
- [x] **Crear migración** Prisma para tablas de órdenes
- [ ] **Actualizar seeds** con datos de prueba de órdenes

#### **✅ 2.2 Estructura Backend - Órdenes**

- [x] **Crear módulo principal** `orders/`
- [x] **Estructura modular interna**:
  ```
  orders/
  ├── purchase-orders/
  ├── sales-orders/
  ├── stock-transfers/
  ├── return-orders/
  └── shared/
  ```

### **FASE 3: Módulos de Inventario (Semana 5-6)**

#### **✅ 3.1 Inventory Locations Module**

- [x] **Controller**: `locations.controller.ts`
  - `POST /inventory/locations` - Crear ubicación
  - `GET /inventory/locations` - Listar por organización
  - `GET /inventory/locations/:id` - Detalle
  - `PUT /inventory/locations/:id` - Actualizar
  - `DELETE /inventory/locations/:id` - Desactivar
- [x] **Service**: `locations.service.ts`
  - Gestión de almacenes y zonas
  - Validación de códigos únicos por organización
  - Integración con direcciones
- [x] **DTOs**: Creación, actualización, query
- [ ] **Interfaces**: Tipos de datos

#### **✅ 3.2 Stock Levels Module**

- [x] **Controller**: `stock-levels.controller.ts`
  - `GET /inventory/stock-levels` - Consulta general
  - `GET /inventory/stock-levels/product/:id` - Stock por producto
  - `GET /inventory/stock-levels/location/:id` - Stock por ubicación
  - `GET /inventory/stock-levels/alerts` - Alertas de stock bajo
- [x] **Service**: `stock-levels.service.ts`
  - Cálculo de available/reserved/on_hand
  - Actualización en tiempo real
  - Integración con movimientos
- [x] **DTOs**: Query, filtros
- [ ] **Interfaces**: Tipos de datos

#### **✅ 3.3 Inventory Movements Module**

- [x] **Controller**: `movements.controller.ts`
  - `GET /inventory/movements` - Historial completo
  - `POST /inventory/movements` - Movimiento manual
  - `GET /inventory/movements/stats` - Estadísticas
- [x] **Service**: `movements.service.ts`
  - Registro automático de todos los movimientos
  - Integración con órdenes
  - Cálculo de costos promedio
- [x] **DTOs**: Query, filtros, creación
- [ ] **Interfaces**: Tipos de datos

#### **✅ 3.4 Suppliers Module**

- [x] **Controller**: `suppliers.controller.ts`
  - `POST /inventory/suppliers` - Crear proveedor
  - `GET /inventory/suppliers` - Listar por organización
  - `GET /inventory/suppliers/:id` - Detalle
  - `PUT /inventory/suppliers/:id` - Actualizar
- [x] **Service**: `suppliers.service.ts`
  - Gestión de proveedores por organización
  - Integración con productos de proveedor
  - Validación de códigos únicos
- [x] **DTOs**: Creación, actualización, query
- [ ] **Interfaces**: Tipos de datos

### **FASE 4: Módulos de Órdenes Corporativas (Semana 7-8)**

#### **✅ 4.1 Purchase Orders Module**

- [x] **Controller**: `purchase-orders.controller.ts`
  - `POST /orders/purchase` - Crear orden de compra
  - `GET /orders/purchase` - Listar con filtros
  - `GET /orders/purchase/:id` - Detalle
  - `PUT /orders/purchase/:id/approve` - Aprobar
  - `PUT /orders/purchase/:id/receive` - Recibir mercancía
  - `PUT /orders/purchase/:id/cancel` - Cancelar
- [x] **Service**: `purchase-orders.service.ts`
  - Lógica de negocio y validaciones
  - Integración con inventario (stock levels)
  - Workflows de aprobación
  - Generación automática de inventory movements
- [x] **DTOs**: Creación, actualización, query
- [ ] **Interfaces**: Tipos de datos

#### **✅ 4.2 Sales Orders Module**

- [x] **Controller**: `sales-orders.controller.ts`
  - `POST /orders/sales` - Crear orden de venta
  - `GET /orders/sales` - Listar con filtros
  - `GET /orders/sales/:id` - Detalle
  - `PUT /orders/sales/:id/confirm` - Confirmar
  - `PUT /orders/sales/:id/ship` - Enviar
  - `PUT /orders/sales/:id/invoice` - Facturar
- [x] **Service**: `sales-orders.service.ts`
  - Reserva de inventario (stock reservations)
  - Cálculos de precios y descuentos
  - Integración con clientes
  - Generación automática de inventory movements
- [x] **DTOs**: Creación, actualización, query
- [ ] **Interfaces**: Tipos de datos

#### **✅ 4.3 Stock Transfers Module**

- [ ] **Controller**: `stock-transfers.controller.ts`
  - `POST /orders/transfers` - Crear transferencia
  - `GET /orders/transfers` - Listar
  - `PUT /orders/transfers/:id/approve` - Aprobar
  - `PUT /orders/transfers/:id/complete` - Completar
- [ ] **Service**: `stock-transfers.service.ts`
  - Validación de stock disponible
  - Movimiento entre ubicaciones
  - Actualización de stock levels
  - Generación automática de inventory movements
- [ ] **DTOs**: Creación, actualización
- [ ] **Interfaces**: Tipos de datos

#### **✅ 4.4 Return Orders Module**

- [ ] **Controller**: `return-orders.controller.ts`
  - `POST /orders/returns` - Crear devolución
  - `GET /orders/returns` - Listar
  - `PUT /orders/returns/:id/process` - Procesar
- [ ] **Service**: `return-orders.service.ts`
  - Lógica para devoluciones de compra/venta
  - Reingreso de inventario
  - Gestión de condiciones del producto
  - Generación automática de inventory movements
- [ ] **DTOs**: Creación, procesamiento
- [ ] **Interfaces**: Tipos de datos

### **FASE 5: Servicios Compartidos (Semana 9)**

#### **✅ 5.1 Inventory Integration Service**

- [ ] **Service**: `inventory-integration.service.ts`
  - Reserva/liberación automática de stock
  - Actualización de stock levels desde órdenes
  - Generación de inventory movements
  - Cálculo de costos promedio ponderado
  - Validación de disponibilidad

#### **✅ 5.2 Workflow Services**

- [ ] **Order Workflow Service**:
  - Estados y transiciones para todos los tipos de órdenes
  - Validaciones por estado
  - Acciones automáticas (reservas, movimientos)
- [ ] **Approval Workflow Service**:
  - Reglas de aprobación por monto y tipo
  - Notificaciones a aprobadores
  - Historial de aprobaciones

#### **✅ 5.3 Validation Services**

- [ ] **Order Validation Service**:
  - Validaciones de negocio por tipo de orden
  - Reglas de inventario (disponibilidad, ubicaciones)
  - Validaciones de precios y costos
- [ ] **Inventory Validation Service**:
  - Disponibilidad de stock por ubicación
  - Validaciones de transferencias entre ubicaciones
  - Reglas de movimiento y ajustes

### **FASE 6: Frontend (Semana 10-11)**

#### **✅ 6.1 Componentes de Inventario**

- [ ] **Inventory Locations Component**: Gestión de almacenes
- [ ] **Stock Levels Component**: Visualización de stock
- [ ] **Inventory Movements Component**: Historial de movimientos
- [ ] **Suppliers Component**: Gestión de proveedores
- [ ] **Inventory Dashboard**: Vista general de inventario

#### **✅ 6.2 Componentes de Órdenes**

- [ ] **Purchase Orders Component**: Lista, creación, edición
- [ ] **Sales Orders Component**: Lista, creación, edición
- [ ] **Stock Transfers Component**: Gestión de transferencias
- [ ] **Return Orders Component**: Gestión de devoluciones
- [ ] **Order Status Component**: Indicadores de estado

#### **✅ 6.3 Componentes Compartidos**

- [ ] **Product Selector Component**: Selector con stock disponible
- [ ] **Location Selector Component**: Selector de ubicaciones
- [ ] **Supplier Selector Component**: Selector de proveedores
- [ ] **Order Items Component**: Gestión de items de orden

### **FASE 7: Testing y Optimización (Semana 12)**

#### **✅ 7.1 Testing**

- [ ] **Unit Tests**: Todos los servicios de inventario y órdenes
- [ ] **Integration Tests**: Endpoints principales
- [ ] **E2E Tests**: Flujos completos (compra → venta → transferencia)
- [ ] **Performance Tests**: Carga de datos de inventario

#### **✅ 7.2 Optimización**

- [ ] **Database Optimization**: Índices compuestos multi-tenant
- [ ] **Caching Strategy**: Redis para stock levels frecuentes
- [ ] **API Documentation**: Swagger/OpenAPI
- [ ] **Error Handling**: Manejo robusto de errores de inventario

## **Estructura Final de Archivos**

### **Módulo de Inventario**

```
src/modules/inventory/
├── locations/
│   ├── locations.controller.ts
│   ├── locations.service.ts
│   ├── dto/
│   │   ├── create-location.dto.ts
│   │   ├── update-location.dto.ts
│   │   └── location-query.dto.ts
│   └── interfaces/
│       └── location.interface.ts
├── stock-levels/
│   ├── stock-levels.controller.ts
│   ├── stock-levels.service.ts
│   ├── dto/
│   │   └── stock-level-query.dto.ts
│   └── interfaces/
│       └── stock-level.interface.ts
├── movements/
│   ├── movements.controller.ts
│   ├── movements.service.ts
│   ├── dto/
│   │   ├── create-movement.dto.ts
│   │   └── movement-query.dto.ts
│   └── interfaces/
│       └── movement.interface.ts
├── suppliers/
│   ├── suppliers.controller.ts
│   ├── suppliers.service.ts
│   ├── dto/
│   │   ├── create-supplier.dto.ts
│   │   ├── update-supplier.dto.ts
│   │   └── supplier-query.dto.ts
│   └── interfaces/
│       └── supplier.interface.ts
├── batches/
│   ├── batches.controller.ts
│   ├── batches.service.ts
│   ├── dto/
│   └── interfaces/
├── serial-numbers/
│   ├── serial-numbers.controller.ts
│   ├── serial-numbers.service.ts
│   ├── dto/
│   └── interfaces/
├── adjustments/
│   ├── adjustments.controller.ts
│   ├── adjustments.service.ts
│   ├── dto/
│   └── interfaces/
├── reservations/
│   ├── reservations.controller.ts
│   ├── reservations.service.ts
│   ├── dto/
│   └── interfaces/
├── shared/
│   ├── services/
│   │   ├── inventory-integration.service.ts
│   │   ├── inventory-validation.service.ts
│   │   ├── stock-calculator.service.ts
│   │   └── location-validator.service.ts
│   ├── interfaces/
│   │   ├── inventory.interface.ts
│   │   └── movement.interface.ts
│   └── utils/
│       ├── stock-calculator.ts
│       └── location-validator.ts
└── inventory.module.ts
```

### **Módulo de Órdenes**

```
src/modules/orders/
├── purchase-orders/
│   ├── purchase-orders.controller.ts
│   ├── purchase-orders.service.ts
│   ├── dto/
│   │   ├── create-purchase-order.dto.ts
│   │   ├── update-purchase-order.dto.ts
│   │   └── purchase-order-query.dto.ts
│   └── interfaces/
│       └── purchase-order.interface.ts
├── sales-orders/
│   ├── sales-orders.controller.ts
│   ├── sales-orders.service.ts
│   ├── dto/
│   │   ├── create-sales-order.dto.ts
│   │   ├── update-sales-order.dto.ts
│   │   └── sales-order-query.dto.ts
│   └── interfaces/
│       └── sales-order.interface.ts
├── stock-transfers/
│   ├── stock-transfers.controller.ts
│   ├── stock-transfers.service.ts
│   ├── dto/
│   │   ├── create-transfer.dto.ts
│   │   └── transfer-query.dto.ts
│   └── interfaces/
│       └── transfer.interface.ts
├── return-orders/
│   ├── return-orders.controller.ts
│   ├── return-orders.service.ts
│   ├── dto/
│   │   ├── create-return-order.dto.ts
│   │   └── return-order-query.dto.ts
│   └── interfaces/
│       └── return-order.interface.ts
├── shared/
│   ├── services/
│   │   ├── order-workflow.service.ts
│   │   ├── approval-workflow.service.ts
│   │   ├── order-validation.service.ts
│   │   ├── order-number-generator.service.ts
│   │   └── order-integration.service.ts
│   ├── interfaces/
│   │   ├── order.interface.ts
│   │   ├── workflow.interface.ts
│   │   └── approval.interface.ts
│   └── utils/
│       ├── order-number.generator.ts
│       ├── status.validator.ts
│       └── order-calculator.ts
└── orders.module.ts
```

## **Modelo de Datos Completo - Fase 3**

### **1. Sistema de Inventario Multi-Tenant**

#### **Ubicaciones de Inventario (Por Organización)**

```sql
inventory_locations
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento por organización
├── store_id (FK → stores, nullable)     # Opcional: ubicación específica de tienda
├── name
├── code
├── type (warehouse, store, production_area, receiving_area, shipping_area, quarantine, damaged_goods)
├── is_active
├── address_id (FK → addresses)
├── created_at
├── updated_at
└── indexes:
    ├── [organization_id, code] (unique)
    ├── [organization_id, store_id]
    └── [organization_id, type]
```

#### **Niveles de Stock (Multi-Location)**

```sql
stock_levels
├── id (PK)
├── product_id (FK → products)            # Hereda organization_id del producto
├── product_variant_id (FK → product_variants)
├── location_id (FK → inventory_locations) # Hereda organization_id
├── quantity_on_hand
├── quantity_reserved
├── quantity_available
├── reorder_point
├── max_stock
├── cost_per_unit
├── last_updated
└── unique: [product_id, product_variant_id, location_id]
# Restricción: location.organization_id = product.store.organization_id
```

#### **Movimientos de Inventario (Auditoría Multi-Tenant)**

```sql
inventory_movements
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento principal
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── from_location_id (FK → inventory_locations) # Hereda organization_id
├── to_location_id (FK → inventory_locations)   # Hereda organization_id
├── quantity
├── movement_type (stock_in, stock_out, transfer, adjustment, sale, return, damage, expiration)
├── source_order_type (purchase, sale, transfer, return)
├── source_order_id
├── reason
├── notes
├── user_id (FK → users)                  # Hereda organization_id
├── created_at
└── indexes:
    ├── [organization_id, product_id, created_at]
    ├── [organization_id, from_location_id, created_at]
    ├── [organization_id, to_location_id, created_at]
    └── [organization_id, user_id, created_at]
```

#### **Control de Lotes (Por Organización)**

```sql
inventory_batches
├── id (PK)
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── batch_number
├── quantity
├── quantity_used
├── manufacturing_date
├── expiration_date
├── location_id (FK → inventory_locations) # Hereda organization_id
├── created_at
└── unique: [product_id, batch_number]
# Restricción: location.organization_id = product.store.organization_id
```

#### **Números de Serie (Multi-Tenant)**

```sql
inventory_serial_numbers
├── id (PK)
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── serial_number
├── status (in_stock, reserved, sold, returned, damaged, expired, in_transit)
├── location_id (FK → inventory_locations) # Hereda organization_id
├── batch_id (FK → inventory_batches)     # Hereda organization_id
├── cost
├── sold_date
├── warranty_expiry
├── notes
├── created_at
├── updated_at
└── unique: [serial_number]
# Restricciones de consistencia multi-tenant
```

#### **Proveedores (Por Organización)**

```sql
suppliers
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento estricto
├── name
├── code
├── email
├── phone
├── website
├── tax_id
├── payment_terms
├── lead_time_days
├── is_active
├── created_at
├── updated_at
└── indexes:
    ├── [organization_id, code] (unique)
    └── [organization_id, name]
```

#### **Productos de Proveedores (Multi-Tenant)**

```sql
supplier_products
├── id (PK)
├── supplier_id (FK → suppliers)         # Hereda organization_id
├── product_id (FK → products)            # Hereda organization_id
├── supplier_sku
├── cost_per_unit
├── min_order_qty
├── lead_time_days
├── is_preferred
├── created_at
├── updated_at
└── unique: [supplier_id, product_id]
# Restricción: supplier.organization_id = product.store.organization_id
```

#### **Ajustes de Inventario (Por Organización)**

```sql
inventory_adjustments
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento principal
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── location_id (FK → inventory_locations) # Hereda organization_id
├── adjustment_type (damage, loss, theft, expiration, count_variance, manual_correction)
├── quantity_before
├── quantity_after
├── quantity_change
├── reason_code
├── description
├── approved_by_user_id (FK → users)      # Hereda organization_id
├── created_by_user_id (FK → users)      # Hereda organization_id
├── approved_at
├── created_at
└── indexes:
    ├── [organization_id, location_id, adjustment_type]
    ├── [organization_id, created_by_user_id, created_at]
    └── [organization_id, approved_by_user_id, approved_at]
```

#### **Reservas de Stock (Multi-Tenant)**

```sql
stock_reservations
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento principal
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── location_id (FK → inventory_locations) # Hereda organization_id
├── quantity
├── reserved_for_type (order, transfer, adjustment)
├── reserved_for_id
├── expires_at
├── status (active, consumed, expired, cancelled)
├── user_id (FK → users)                  # Hereda organization_id
├── created_at
├── updated_at
└── indexes:
    ├── [organization_id, reserved_for_type, reserved_for_id]
    ├── [organization_id, location_id, status]
    └── [organization_id, expires_at, status]
```

### **2. Sistema de Órdenes Corporativo**

#### **Órdenes de Compra (Por Organización)**

```sql
purchase_orders
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento principal
├── supplier_id (FK → suppliers)          # Hereda organization_id
├── location_id (FK → inventory_locations) # Hereda organization_id
├── order_number
├── status ENUM('draft', 'approved', 'received', 'cancelled')
├── order_date
├── expected_date
├── received_date
├── subtotal_amount
├── tax_amount
├── total_amount
├── notes
├── created_by_user_id (FK → users)      # Hereda organization_id
├── approved_by_user_id (FK → users, nullable)
├── created_at
├── updated_at
└── unique: [organization_id, order_number]

purchase_order_items
├── id (PK)
├── purchase_order_id (FK → purchase_orders) # Hereda organization_id
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── quantity_ordered
├── quantity_received
├── unit_cost
├── total_cost
├── notes
├── created_at
└── indexes:
    ├── [purchase_order_id]
    └── [product_id, purchase_order_id]
```

#### **Órdenes de Venta (Por Organización)**

```sql
sales_orders
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento principal
├── customer_id (FK → users)              # Hereda organization_id
├── order_number
├── status ENUM('draft', 'confirmed', 'shipped', 'invoiced', 'cancelled')
├── shipping_address_id (FK → addresses)
├── created_by_user_id (FK → users)      # Hereda organization_id
├── approved_by_user_id (FK → users, nullable)
├── created_at
├── updated_at
└── unique: [organization_id, order_number]

sales_order_items
├── id (PK)
├── sales_order_id (FK → sales_orders)    # Hereda organization_id
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── quantity
├── unit_price
├── discount
├── total_price
├── created_at
└── indexes:
    ├── [sales_order_id]
    └── [product_id, sales_order_id]
```

#### **Transferencias de Stock (Multi-Tenant)**

```sql
stock_transfers
├── id (PK)
├── transfer_number
├── organization_id (FK → organizations)  # Aislamiento principal
├── from_location_id (FK → inventory_locations) # Hereda organization_id
├── to_location_id (FK → inventory_locations)   # Hereda organization_id
├── status ENUM('draft', 'in_transit', 'completed', 'cancelled')
├── transfer_date
├── expected_date
├── completed_date
├── notes
├── created_by_user_id (FK → users)      # Hereda organization_id
├── approved_by_user_id (FK → users, nullable)
├── created_at
├── updated_at
└── unique: [organization_id, transfer_number]
# Restricción: from_location.organization_id = to_location.organization_id

stock_transfer_items
├── id (PK)
├── stock_transfer_id (FK → stock_transfers) # Hereda organization_id
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── quantity
├── quantity_received
├── notes
├── created_at
└── indexes:
    ├── [stock_transfer_id]
    └── [product_id, stock_transfer_id]
```

#### **Órdenes de Devolución (Multi-Tenant)**

```sql
return_orders
├── id (PK)
├── organization_id (FK → organizations)  # Aislamiento principal
├── related_order_id (FK → sales_orders/purchase_orders)
├── partner_id (FK → users/suppliers)
├── type ENUM('purchase_return', 'sales_return')
├── status ENUM('draft', 'processed', 'cancelled')
├── reason_id
├── created_at
├── updated_at
└── indexes: [organization_id, type, status]

return_order_items
├── id (PK)
├── return_order_id (FK → return_orders) # Hereda organization_id
├── product_id (FK → products)            # Hereda organization_id
├── product_variant_id (FK → product_variants)
├── quantity
├── condition ENUM('good', 'damaged')
├── created_at
└── indexes: [return_order_id, product_id]
```

#### **Sales Orders (Órdenes de Venta)**

```sql
sales_orders
├── id (PK)
├── organization_id (FK → organizations)
├── customer_id (FK → users)
├── order_number (UNIQUE)
├── status ENUM('draft', 'confirmed', 'shipped', 'invoiced', 'cancelled')
├── shipping_address_id (FK → addresses)
├── created_by (FK → users)
├── approved_by (FK → users, nullable)
├── created_at
└── updated_at

sales_order_items
├── id (PK)
├── sales_order_id (FK → sales_orders)
├── product_id (FK → products)
├── quantity
├── unit_price
├── discount
└── total_price
```

#### **Stock Transfers (Transferencias de Inventario)**

```sql
stock_transfers
├── id (PK)
├── organization_id (FK → organizations)
├── from_location_id (FK → inventory_locations)
├── to_location_id (FK → inventory_locations)
├── status ENUM('draft', 'in_transit', 'completed', 'cancelled')
├── transfer_number (UNIQUE)
├── created_by (FK → users)
├── approved_by (FK → users, nullable)
├── created_at
└── updated_at

stock_transfer_items
├── id (PK)
├── stock_transfer_id (FK → stock_transfers)
├── product_id (FK → products)
└── quantity
```

#### **Return Orders (Devoluciones)**

```sql
return_orders
├── id (PK)
├── organization_id (FK → organizations)
├── related_order_id (FK → sales_orders/purchase_orders)
├── partner_id (FK → users/suppliers)
├── type ENUM('purchase_return', 'sales_return')
├── status ENUM('draft', 'processed', 'cancelled')
├── reason_id
├── created_at
└── updated_at

return_order_items
├── id (PK)
├── return_order_id (FK → return_orders)
├── product_id (FK → products)
├── quantity
└── condition ENUM('good', 'damaged')
```

#### **Inventory System**

```sql
inventory_movements
├── id (PK)
├── organization_id (FK → organizations)
├── product_id (FK → products)
├── movement_type ENUM('in', 'out')
├── source_order_type ENUM('purchase', 'sale', 'transfer', 'return')
├── source_order_id
├── location_id (FK → inventory_locations)
├── quantity
├── batch_id (FK → inventory_batches, nullable)
└── created_at

stock_levels
├── id (PK)
├── organization_id (FK → organizations)
├── product_id (FK → products)
├── location_id (FK → inventory_locations)
├── available
├── reserved
└── indexes: [organization_id, product_id, location_id]
```

## **Prioridades de Desarrollo**

### **🔥 Alta Prioridad (Crítico)**

1. Schema Prisma completo (inventario + órdenes)
2. Migraciones de base de datos
3. Módulos de inventario core (locations, stock-levels, movements)
4. Módulos de órdenes core (purchase, sales, transfers)
5. Integración inventario-órdenes
6. Servicios de workflow y validación

### **🟡 Media Prioridad (Importante)**

1. Módulos avanzados (batches, serial-numbers, adjustments)
2. Componentes frontend principales
3. Servicios de notificaciones
4. Reportes básicos y dashboards
5. Testing unitario y de integración

### **🟢 Baja Prioridad (Deseable)**

1. Analíticas avanzadas
2. Optimización extrema de performance
3. Documentación extendida
4. Testing E2E completo
5. Features adicionales (forecasting, etc.)

## **Consideraciones Multi-Tenant Avanzadas**

### **Aislamiento de Datos Estricto**

- **Herencia de Contexto**: Todas las tablas heredan `organization_id` de sus padres
- **Índices Compuestos**: Todos los índices incluyen `organization_id` como primer campo
- **Row Level Security (RLS)**: Políticas por organización para todas las tablas
- **Validaciones Cruzadas**: Restricciones para mantener consistencia multi-tenant

### **Contexto de Ejecución Automático**

- **Middleware Global**: Inyecta `organization_id` y `store_id` en todas las requests
- **Servicios Context-Aware**: Validan automáticamente el contexto del tenant
- **Queries Filtradas**: Todas las consultas incluyen filtro por tenant por defecto
- **Auditoría Completa**: Todos los cambios registrados por organización y usuario

### **Escalabilidad Multi-Tenant**

- **Particionamiento Horizontal**: Por `organization_id` si es necesario
- **Caching Inteligente**: Claves de cache incluyen `organization_id`
- **Connection Pooling**: Opcional: pools por tenant para grandes volúmenes
- **Backup/Restore**: Estrategias por tenant o consolidadas

## **Integraciones Requeridas**

### **Módulos Existentes (Modificaciones Necesarias)**

- **Products**:
  - Agregar campos de tracking de inventario
  - Relaciones con stock_levels y inventory_movements
- **Users**:
  - Roles específicos para gestión de inventario y órdenes
  - Permisos granulares por tipo de operación
- **Organizations**:
  - Configuración de políticas de inventario
  - Ubicaciones por defecto
- **Stores**:
  - Relación con inventory_locations
  - Configuración de stock por tienda
- **Auth**:
  - Nuevos permisos para operaciones de inventario
  - Roles de aprobación por monto y tipo

### **Nuevos Módulos Completos**

- **Inventory Management**: Sistema completo de gestión de inventario
- **Order Management**: Sistema corporativo de órdenes
- **Supplier Management**: Gestión de proveedores
- **Location Management**: Gestión de almacenes y zonas

## **Flujos de Negocio Integrados**

### **1. Flujo de Compra Completo**

```
Create Purchase Order → Validate Stock Capacity → Approve →
Receive Stock → Update Stock Levels → Create Inventory Movements →
Update Costs → Process Payment
```

### **2. Flujo de Venta Completo**

```
Create Sales Order → Check Stock Availability → Reserve Stock →
Confirm Order → Create Inventory Movements → Ship →
Invoice → Receive Payment → Update Stock Levels
```

### **3. Flujo de Transferencia Completo**

```
Create Transfer Request → Validate Source Stock → Approve →
Create Inventory Movements → In Transit → Receive at Destination →
Update Stock Levels at Both Locations
```

### **4. Flujo de Devolución Completo**

```
Create Return Order → Validate Original Order → Process Return →
Inspect Condition → Create Inventory Movements →
Restock/Write-off → Process Refund/Credit
```

### **5. Flujo de Ajuste de Inventario**

```
Create Adjustment Request → Validate Reason → Approve →
Create Inventory Movements → Update Stock Levels →
Audit Trail Generation
```

## **Enums Definidos**

### **Tipos de Ubicación**

```typescript
enum location_type_enum {
  warehouse,
  store,
  production_area,
  receiving_area,
  shipping_area,
  quarantine,
  damaged_goods,
}
```

### **Tipos de Movimiento**

```typescript
enum movement_type_enum {
  stock_in,
  stock_out,
  transfer,
  adjustment,
  sale,
  return,
  damage,
  expiration,
}
```

### **Status de Órdenes**

```typescript
enum purchase_order_status_enum {
  draft,
  approved,
  received,
  cancelled,
}

enum sales_order_status_enum {
  draft,
  confirmed,
  shipped,
  invoiced,
  cancelled,
}

enum transfer_status_enum {
  draft,
  in_transit,
  completed,
  cancelled,
}
```

### **Estados de Inventario**

```typescript
enum serial_status_enum {
  in_stock,
  reserved,
  sold,
  returned,
  damaged,
  expired,
  in_transit,
}
```

Esta ruta garantiza un desarrollo modular, escalable y mantenible con full multi-tenancy, integración completa entre inventario y órdenes, y seguimiento del modelo corporativo especificado.
