# Módulo POS (Point of Sale)

## Overview

El módulo POS de Vendix es un sistema completo de punto de venta diseñado para gestionar transacciones comerciales de manera eficiente. Ofrece una interfaz intuitiva, procesamiento rápido de pagos, gestión de inventario integrada y capacidades offline.

## Arquitectura

### Estructura del Módulo

```
src/app/private/modules/store/pos/
├── components/
│   ├── pos-dashboard.component.ts
│   ├── pos-keyboard-shortcuts.component.ts
│   ├── pos-payment.component.ts
│   ├── pos-product-search.component.ts
│   └── pos-ticket-printer.component.ts
├── models/
│   ├── cart.model.ts
│   ├── dashboard.model.ts
│   ├── order.model.ts
│   ├── payment.model.ts
│   └── ticket.model.ts
├── services/
│   ├── pos-cart.service.ts
│   ├── pos-dashboard.service.ts
│   ├── pos-keyboard.service.ts
│   ├── pos-offline.service.ts
│   ├── pos-payment.service.ts
│   ├── pos-product.service.ts
│   └── pos-ticket.service.ts
├── cart/
│   └── pos-cart.component.ts
├── payment/
│   └── pos-payment.component.ts
├── register/
│   └── pos-register.component.ts
└── pos.component.ts
```

## Características Principales

### 1. Gestión de Productos

- **Búsqueda avanzada**: Por nombre, SKU, código de barras, categorías y marcas
- **Filtros múltiples**: Precio, stock, categorías, ordenamiento
- **Escáner de códigos de barras**: Integrado con cámara y dispositivos físicos
- **Historial de búsqueda**: Guarda búsquedas recientes para acceso rápido

### 2. Carrito de Compras

- **Gestión intuitiva**: Agregar, modificar, eliminar productos
- **Cálculos automáticos**: Subtotal, impuestos, descuentos, total
- **Validación de stock**: Previene venta de productos sin existencia
- **Descuentos flexibles**: Por porcentaje o monto fijo

### 3. Gestión de Clientes

- **Selección rápida**: Búsqueda de clientes existentes
- **Registro rápido**: Creación de clientes en tiempo real
- **Historial de compras**: Acceso a compras anteriores
- **Datos fiscales**: Soporte para NIT y facturación

### 4. Procesamiento de Pagos

- **Múltiples métodos**: Efectivo, tarjeta, transferencia, billeteras digitales
- **Validación automática**: Verificación de datos de pago
- **Cálculo de cambio**: Automático para pagos en efectivo
- **Referencias de pago**: Soporte para comprobantes

### 5. Impresión de Tickets

- **Múltiples formatos**: Térmico, estándar, PDF
- **Personalización**: Plantillas configurables
- **Opciones de envío**: Email, SMS, impresión física
- **Caja registradora**: Integración automática

### 6. Atajos de Teclado

- **Navegación rápida**: Acceso directo a funciones principales
- **Búsqueda optimizada**: Atajos para búsqueda de productos
- **Gestión de carrito**: Atajos para operaciones comunes
- **Procesamiento de pagos**: Atajos para métodos de pago

### 7. Modo Offline

- **Operación continua**: Funciona sin conexión a internet
- **Sincronización automática**: Actualiza datos al reconectar
- **Almacenamiento local**: Guarda transacciones pendientes
- **Gestión de colas**: Organiza operaciones de sincronización

### 8. Dashboard de Estadísticas

- **Métricas en tiempo real**: Ventas, órdenes, clientes
- **Análisis temporal**: Diario, semanal, mensual, anual
- **Productos populares**: Identificación de best-sellers
- **Métodos de pago**: Estadísticas de uso
- **Exportación de datos**: CSV, Excel, PDF

## Componentes

### PosComponent

Componente principal que orquesta toda la funcionalidad del POS.

```typescript
@Component({
  selector: "app-pos",
  standalone: true,
  imports: [CommonModule /* otros imports */],
})
export class PosComponent {
  // Lógica principal del POS
}
```

### PosProductSearchComponent

Componente para búsqueda y filtrado de productos.

**Eventos:**

- `search`: Emitido cuando se realiza una búsqueda
- `productSelected`: Emitido cuando se selecciona un producto
- `barcodeScanned`: Emitido cuando se escanea un código de barras

### PosPaymentComponent

Componente para procesamiento de pagos.

**Inputs:**

- `totalAmount`: Monto total a pagar
- `orderId`: ID de la orden

**Outputs:**

- `paymentComplete`: Emitido cuando el pago se completa
- `paymentCancelled`: Emitido cuando se cancela el pago

### PosTicketPrinterComponent

Componente para impresión de tickets.

**Inputs:**

- `ticketData`: Datos del ticket a imprimir

**Outputs:**

- `printComplete`: Emitido cuando la impresión se completa
- `printerClosed`: Emitido cuando se cierra el diálogo

## Servicios

### PosProductService

Gestiona la búsqueda y gestión de productos.

**Métodos principales:**

- `searchProducts()`: Busca productos con filtros
- `getProductByBarcode()`: Obtiene producto por código de barras
- `getCategories()`: Obtiene categorías disponibles
- `getPopularProducts()`: Obtiene productos populares

### PosPaymentService

Procesa transacciones de pago.

**Métodos principales:**

- `processPayment()`: Procesa un pago
- `getPaymentMethods()`: Obtiene métodos disponibles
- `getTransactionHistory()`: Obtiene historial de transacciones

### PosCartService

Gestiona el carrito de compras.

**Métodos principales:**

- `addToCart()`: Agrega producto al carrito
- `removeFromCart()`: Elimina producto del carrito
- `updateQuantity()`: Actualiza cantidad de producto
- `clearCart()`: Vacía el carrito
- `calculateTotals()`: Calcula totales del carrito

### PosTicketService

Gestiona la impresión de tickets.

**Métodos principales:**

- `printTicket()`: Imprime un ticket
- `generateTicketHTML()`: Genera HTML del ticket
- `previewTicket()`: Previsualiza ticket

### PosKeyboardService

Gestiona atajos de teclado.

**Métodos principales:**

- `registerShortcut()`: Registra un atajo
- `enableShortcuts()`: Habilita atajos
- `disableShortcuts()`: Deshabilita atajos

### PosOfflineService

Gestiona funcionalidad offline.

**Métodos principales:**

- `saveOfflineData()`: Guarda datos offline
- `attemptSync()`: Intenta sincronizar datos
- `getOfflineStatus()`: Obtiene estado offline

### PosDashboardService

Proporciona datos para el dashboard.

**Métodos principales:**

- `getDashboardData()`: Obtiene datos del dashboard
- `getRealTimeStats()`: Obtiene estadísticas en tiempo real
- `exportDashboardData()`: Exporta datos del dashboard

## Modelos de Datos

### CartItem

```typescript
interface CartItem {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
  tax?: number;
}
```

### PaymentRequest

```typescript
interface PaymentRequest {
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string;
  cashReceived?: number;
  customerEmail?: string;
  customerPhone?: string;
}
```

### TicketData

```typescript
interface TicketData {
  id: string;
  date: Date;
  items: TicketItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  cashReceived?: number;
  change?: number;
  customer?: CustomerInfo;
  store?: StoreInfo;
}
```

## Uso Básico

### 1. Configuración del Módulo

```typescript
// En tu módulo o componente principal
import { PosComponent } from "./pos/pos.component";
import { PosProductService } from "./pos/services/pos-product.service";
import { PosPaymentService } from "./pos/services/pos-payment.service";

@Component({
  // ...
  imports: [PosComponent],
  providers: [PosProductService, PosPaymentService],
})
export class StoreModule {}
```

### 2. Búsqueda de Productos

```typescript
constructor(private productService: PosProductService) {}

searchProducts() {
  const filters = {
    query: 'laptop',
    category: 'Electrónica',
    inStock: true,
    sortBy: 'name',
    sortOrder: 'asc'
  };

  this.productService.searchProducts(filters).subscribe(result => {
    console.log('Productos encontrados:', result.products);
  });
}
```

### 3. Gestión del Carrito

```typescript
constructor(private cartService: PosCartService) {}

addToCart(product: Product) {
  this.cartService.addToCart({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    quantity: 1,
    unitPrice: product.price
  });
}

getCartTotal() {
  return this.cartService.calculateTotals();
}
```

### 4. Procesamiento de Pagos

```typescript
constructor(private paymentService: PosPaymentService) {}

processPayment() {
  const request: PaymentRequest = {
    orderId: 'ORD-123',
    amount: 999.99,
    paymentMethod: { id: 'cash', name: 'Efectivo', type: 'cash' },
    cashReceived: 1000
  };

  this.paymentService.processPayment(request).subscribe(result => {
    if (result.success) {
      console.log('Pago exitoso:', result.transactionId);
    }
  });
}
```

## Atajos de Teclado

| Atajo  | Función                  |
| ------ | ------------------------ |
| F1     | Mostrar ayuda de atajos  |
| /      | Enfocar búsqueda         |
| F2     | Abrir escáner de códigos |
| F3     | Vaciar carrito           |
| F4     | Ver detalles del carrito |
| F5     | Buscar cliente           |
| F6     | Agregar nuevo cliente    |
| F9     | Iniciar pago             |
| F10    | Pago rápido en efectivo  |
| F11    | Pago rápido con tarjeta  |
| F12    | Completar venta          |
| Ctrl+S | Poner venta en espera    |
| Ctrl+R | Reanudar venta           |
| Escape | Cancelar acción          |

## Configuración

### Configuración de Impresora

```typescript
const printerConfig: PrinterConfig = {
  name: "Default Thermal Printer",
  type: "thermal",
  paperWidth: 80,
  copies: 1,
  autoPrint: true,
  printHeader: true,
  printFooter: true,
  printBarcode: true,
};
```

### Configuración Offline

```typescript
const offlineSettings = {
  autoSync: true,
  maxStorageSize: 50 * 1024 * 1024, // 50MB
  retryAttempts: 3,
  syncInterval: 30000, // 30 segundos
};
```

## Mejores Prácticas

### 1. Manejo de Errores

Siempre implementa manejo de errores en las operaciones críticas:

```typescript
this.paymentService.processPayment(request).subscribe({
  next: (result) => {
    if (result.success) {
      // Procesar éxito
    } else {
      // Mostrar mensaje de error
      this.showError(result.message);
    }
  },
  error: (error) => {
    console.error("Error en pago:", error);
    this.showError("Error al procesar el pago");
  },
});
```

### 2. Validación de Datos

Valide datos antes de enviarlos:

```typescript
validatePayment(request: PaymentRequest): boolean {
  if (!request.orderId || !request.amount || !request.paymentMethod) {
    return false;
  }

  if (request.paymentMethod.type === 'cash' &&
      (!request.cashReceived || request.cashReceived < request.amount)) {
    return false;
  }

  return true;
}
```

### 3. Optimización de Rendimiento

Use debouncing para búsquedas:

```typescript
private searchSubject = new Subject<string>();

ngOnInit() {
  this.searchSubject.pipe(
    debounceTime(300),
    distinctUntilChanged()
  ).subscribe(query => {
    this.performSearch(query);
  });
}

onSearchInput(query: string) {
  this.searchSubject.next(query);
}
```

## Testing

### Unit Tests

```typescript
describe("PosCartService", () => {
  let service: PosCartService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PosCartService);
  });

  it("should add item to cart", () => {
    const item = { productId: "1", name: "Test", quantity: 1, unitPrice: 100 };
    service.addToCart(item);
    expect(service.getCartItems().length).toBe(1);
  });
});
```

### Integration Tests

```typescript
describe("POS Integration", () => {
  it("should complete full sale flow", () => {
    // 1. Agregar productos al carrito
    // 2. Seleccionar cliente
    // 3. Procesar pago
    // 4. Imprimir ticket
    // 5. Verificar resultado
  });
});
```

## Troubleshooting

### Problemas Comunes

1. **Productos no aparecen en búsqueda**
   - Verificar que los productos estén activos
   - Comprobar filtros aplicados
   - Revisar conexión a internet

2. **Error en procesamiento de pago**
   - Validar datos de pago
   - Verificar método de pago disponible
   - Comprobar conexión con pasarela de pago

3. **Ticket no se imprime**
   - Verificar configuración de impresora
   - Comprobar conexión física
   - Revisar permisos del navegador

4. **Modo offline no funciona**
   - Verificar disponibilidad de localStorage
   - Comprobar cuota de almacenamiento
   - Limpiar datos antiguos si es necesario

## Contribución

Para contribuir al módulo POS:

1. Seguir las convenciones de código establecidas
2. Escribir tests para nuevas funcionalidades
3. Actualizar documentación
4. Realizar code review antes de merge

## Licencia

Este módulo está licenciado bajo los términos del proyecto Vendix principal.
