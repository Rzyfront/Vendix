# Wompi – Guía Completa de Integración

> Investigación sobre la integración de la API REST de Wompi Colombia, el Widget de checkout, la creación de transacciones, enlaces de pago y recepción de eventos vía webhook.
>
> Basado en la [documentación oficial Wompi Colombia](https://docs.wompi.co) y repositorios públicos de referencia.

---

## Tabla de Contenido

1. [Visión General](#1-visión-general)
2. [Ambientes y Credenciales](#2-ambientes-y-credenciales)
3. [API REST – Endpoints Principales](#3-api-rest--endpoints-principales)
4. [Widget Checkout (Web Checkout)](#4-widget-checkout-web-checkout)
5. [Integración Directa (API REST)](#5-integración-directa-api-rest)
6. [Enlaces de Pago (Payment Links)](#6-enlaces-de-pago-payment-links)
7. [Firma de Integridad (Integrity Signature)](#7-firma-de-integridad-integrity-signature)
8. [Webhooks – Eventos](#8-webhooks--eventos)
9. [Métodos de Pago Soportados](#9-métodos-de-pago-soportados)
10. [Flujos de Integración Recomendados](#10-flujos-de-integración-recomendados)
11. [Repositorios de Referencia](#11-repositorios-de-referencia)
12. [Seguridad y Buenas Prácticas](#12-seguridad-y-buenas-prácticas)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Visión General

Wompi es una pasarela de pagos colombiana que permite recibir pagos con tarjeta de crédito/débito, NEQUI, PSE, Bancolombia (transferencia, botón de recaudo, QR, BNPL), Daviplata, Su Plus y PCOL.

Ofrece **dos modos principales de integración**:

| Modo | Descripción | Complejidad |
|------|-------------|-------------|
| **Widget / Web Checkout** | Redirección a página hosted de Wompi | Baja |
| **API REST directa** | Creas la transacción desde tu backend | Media-Alta |

Ambos modos se complementan con **webhooks** para confirmar el estado final de las transacciones asíncronas.

### URLs base

| Ambiente | URL Base API | URL Checkout |
|----------|-------------|-------------|
| Sandbox | `https://sandbox.wompi.co/v1` | `https://checkout.wompi.co/p/` |
| Producción | `https://production.wompi.co/v1` | `https://checkout.wompi.co/p/` |

> El checkout URL es el mismo para ambos ambientes; la clave pública (`pub_test_` vs `pub_prod_`) determina el ambiente.

---

## 2. Ambientes y Credenciales

### Obtener credenciales

1. Registrarse en [comercios.wompi.co](https://comercios.wompi.co)
2. En el Dashboard, navegar a la sección de Secrets del negocio
3. Obtener:

| Credencial | Prefijo Sandbox | Prefijo Prod | Uso |
|------------|----------------|-------------|-----|
| **Public Key** | `pub_test_` | `pub_prod_` | Frontend (widget, checkout) |
| **Private Key** | `prv_test_` | `prv_prod_` | Backend (API REST autenticada) |
| **Integrity Secret** | — | — | Firma del checkout (SHA-256) |
| **Events Secret** | — | — | Verificación de webhooks |

### Variables de entorno recomendadas

```env
WOMPI_PUBLIC_KEY=pub_test_xxxxx
WOMPI_PRIVATE_KEY=prv_test_xxxxx
WOMPI_INTEGRITY_SECRET=xxxxx
WOMPI_EVENTS_SECRET=xxxxx
WOMPI_ENV=sandbox    # sandbox | production
```

---

## 3. API REST – Endpoints Principales

### 3.1 Obtener Acceptance Tokens

Antes de crear una transacción, debes obtener los tokens de aceptación de términos del comercio.

```http
GET /v1/merchants/{public_key}
Authorization: Bearer {public_key}
```

**Respuesta:**

```json
{
  "data": {
    "id": 12345,
    "name": "Mi Comercio",
    "presigned_acceptance": {
      "acceptance_token": "eyJhbGci...",
      "permalink": "https://wompi.co/terminos/...",
      "type": "acceptance"
    },
    "presigned_personal_data_auth": {
      "acceptance_token": "eyJhbGci...",
      "permalink": "https://wompi.co/privacidad/...",
      "type": "personal_data_auth"
    }
  }
}
```

> Los tokens expiran. Se recomienda cachearlos con TTL de ~5 minutos.

### 3.2 Crear Transacción

```http
POST /v1/transactions
Authorization: Bearer {private_key}
Content-Type: application/json
```

**Body:**

```json
{
  "acceptance_token": "{acceptance_token}",
  "accept_personal_auth": "{personal_auth_token}",
  "amount_in_cents": 5000000,
  "currency": "COP",
  "customer_email": "cliente@ejemplo.com",
  "reference": "ORD-12345",
  "payment_method": {
    "type": "CARD",
    "token": "tok_test_xxxxx",
    "installments": 1
  },
  "redirect_url": "https://mitienda.com/checkout/confirm",
  "signature": "{integrity_signature_hash}"
}
```

**Respuesta:**

```json
{
  "data": {
    "id": "12345-67890-abcdef",
    "created_at": "2025-01-15T10:30:00.000Z",
    "amount_in_cents": 5000000,
    "reference": "ORD-12345",
    "currency": "COP",
    "payment_method_type": "CARD",
    "status": "APPROVED",
    "status_message": "Transaction approved",
    "redirect_url": "https://mitienda.com/checkout/confirm"
  }
}
```

### 3.3 Consultar Transacción

```http
GET /v1/transactions/{transaction_id}
Authorization: Bearer {private_key}
```

### 3.4 Anular Transacción (Void)

```http
POST /v1/transactions/{transaction_id}/void
Authorization: Bearer {private_key}
```

> Wompi soporta void completo. No hay refund parcial nativo vía API.

### 3.5 Obtener Instituciones Financieras (para PSE)

```http
GET /v1/pse/financial_institutions
Authorization: Bearer {public_key}
```

**Respuesta:**

```json
{
  "data": [
    {
      "financial_institution_code": "1",
      "financial_institution_name": "Bancolombia"
    },
    {
      "financial_institution_code": "2",
      "financial_institution_name": "Banco de Bogotá"
    }
  ]
}
```

---

## 4. Widget Checkout (Web Checkout)

El Widget / Web Checkout es la forma más sencilla de integrar Wompi. Rediriges al usuario a una página hosted por Wompi donde selecciona el método de pago y completa la transacción.

### 4.1 Flujo del Widget

```
Tu frontend                    Wompi                     Tu backend
    │                            │                           │
    │  1. Generar firma           │                           │
    │  (SHA-256 integrity)        │                           │
    │                            │                           │
    │  2. Construir URL con       │                           │
    │     parámetros              │                           │
    │                            │                           │
    │  3. Redirect ───────────>  │                           │
    │                            │  Usuario paga             │
    │                            │                           │
    │  <──── Redirect de vuelta  │                           │
    │                            │                           │
    │                            │  4. Webhook ────────────> │
    │                            │  (transaction.updated)    │
    │                            │                           │
    │  5. Verificar estado       │                           │
    │  (poll o redirect)         │                           │
```

### 4.2 Construir la URL de Checkout

La URL base es: `https://checkout.wompi.co/p/`

Se agregan los parámetros como query string:

```typescript
// Generar firma de integridad
import { createHash } from 'crypto';

function generateWompiSignature(
  reference: string,
  amountInCents: number,
  currency: string,
  integritySecret: string,
  expirationTime?: string
): string {
  const parts = [reference, String(amountInCents), currency];
  if (expirationTime) parts.push(expirationTime);
  parts.push(integritySecret);
  const concatenated = parts.join('');
  return createHash('sha256').update(concatenated).digest('hex');
}

// Construir URL de checkout
function buildWompiCheckoutUrl(config: {
  publicKey: string;
  currency: string;
  amountInCents: number;
  reference: string;
  signature: string;
  redirectUrl: string;
  expirationTime?: string;
}): string {
  const base = 'https://checkout.wompi.co/p/';
  const params = new URLSearchParams({
    'public-key': config.publicKey,
    'currency': config.currency,
    'amount-in-cents': String(config.amountInCents),
    'reference': config.reference,
    'signature:integrity': config.signature,
    'redirect-url': config.redirectUrl,
  });
  if (config.expirationTime) {
    params.set('expiration-time', config.expirationTime);
  }
  return `${base}?${params.toString()}`;
}
```

### 4.3 Ejemplo completo de uso (frontend)

```typescript
// Backend: POST /api/payments/init
async function initWompiPayment(orderCode: string): Promise<{ paymentUrl: string }> {
  const reference = `ORD-${orderCode}`;
  const amountInCents = 5000000; // $50,000 COP en centavos
  const currency = 'COP';
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET!;
  const publicKey = process.env.WOMPI_PUBLIC_KEY!;
  const redirectUrl = `https://mitienda.com/orden/${orderCode}?payment=return`;

  const signature = generateWompiSignature(
    reference,
    amountInCents,
    currency,
    integritySecret
  );

  const paymentUrl = buildWompiCheckoutUrl({
    publicKey,
    currency,
    amountInCents,
    reference,
    signature,
    redirectUrl,
  });

  return { paymentUrl };
}

// Frontend: redirigir al usuario
window.location.href = paymentUrl;
```

### 4.4 Widget Embebido (JavaScript)

Wompi también ofrece un widget embebido que se renderiza dentro de tu página:

```html
<script src="https://checkout.wompi.co/widget.js" data-render="button"
  data-public-key="pub_test_xxxxx"
  data-currency="COP"
  data-amount-in-cents="5000000"
  data-reference="ORD-12345"
  data-signature:integrity="{signature_hash}"
  data-redirect-url="https://mitienda.com/confirm">
</script>
```

**Atributos del widget:**

| Atributo | Requerido | Descripción |
|----------|-----------|-------------|
| `data-public-key` | Sí | Clave pública del comercio |
| `data-currency` | Sí | Moneda (COP para Colombia) |
| `data-amount-in-cents` | Sí | Monto en centavos |
| `data-reference` | Sí | Referencia única de la transacción |
| `data-signature:integrity` | Sí | Firma SHA-256 de integridad |
| `data-redirect-url` | No | URL de redirección post-pago |
| `data-render` | No | `button` para botón, omitir para render manual |

---

## 5. Integración Directa (API REST)

La integración directa te da control total sobre la UI y el flujo de pago. Es más compleja pero necesaria para POS, apps nativas, o flujos personalizados.

### 5.1 Flujo de Integración Directa

```
1. GET  /merchants/{public_key}            → Obtener acceptance tokens
2. [Frontend tokeniza tarjeta con Wompi.js] → Obtener token de tarjeta
3. POST /transactions                       → Crear transacción
4. [Si PSE/Bancolombia] → Redirect al banco
5. [Si NEQUI/Daviplata] → Esperar webhook
6. Webhook transaction.updated              → Confirmar estado final
```

### 5.2 payment_method por tipo

#### Tarjeta (CARD)

```json
{
  "type": "CARD",
  "token": "tok_test_abc123",
  "installments": 1
}
```

> El `token` se obtiene via Wompi.js en el frontend (tokenización de tarjeta).

#### NEQUI

```json
{
  "type": "NEQUI",
  "phone_number": "3001234567"
}
```

#### PSE

```json
{
  "type": "PSE",
  "user_type": 0,
  "user_legal_id_type": "CC",
  "user_legal_id": "12345678",
  "financial_institution_code": "1",
  "payment_description": "Compra tienda online"
}
```

#### Bancolombia Transfer

```json
{
  "type": "BANCOLOMBIA_TRANSFER"
}
```

#### Bancolombia QR

```json
{
  "type": "BANCOLOMBIA_QR",
  "payment_description": "Compra POS"
}
```

#### Bancolombia BNPL (Compra Ahora Paga Después)

```json
{
  "type": "BANCOLOMBIA_BNPL",
  "name": "Juan",
  "last_name": "Pérez",
  "user_legal_id_type": "CC",
  "user_legal_id": "12345678",
  "phone_number": "3001234567",
  "phone_code": "+57",
  "redirect_url": "https://mitienda.com/confirm"
}
```

#### Daviplata

```json
{
  "type": "DAVIPLATA",
  "user_legal_id": "12345678",
  "user_legal_id_type": "CC"
}
```

#### Bancolombia Collect (Botón de Recaudo)

```json
{
  "type": "BANCOLOMBIA_COLLECT"
}
```

#### Su Plus

```json
{
  "type": "SU_PLUS",
  "user_legal_id_type": "CC",
  "user_legal_id": "12345678"
}
```

### 5.3 nextAction – Qué hacer después de crear la transacción

Según el método de pago, el `status` puede ser `PENDING` requiriendo una acción:

| Método | status PENDING | Acción |
|--------|---------------|--------|
| CARD | PENDING (3DS) | Redirect a `redirect_url` para autenticación 3DS |
| NEQUI | PENDING | Await: usuario confirma en su celular. Confirmar vía webhook |
| PSE | PENDING | Redirect al banco (`redirect_url`) |
| BANCOLOMBIA_TRANSFER | PENDING | Redirect a `payment_method.extra.async_payment_url` |
| BANCOLOMBIA_QR | PENDING | Await: mostrar QR (`payment_method.extra.qr_image`, base64) |
| BANCOLOMBIA_COLLECT | PENDING | Await: usuario paga desde Bancolombia |
| DAVIPLATA | PENDING | Await: usuario confirma en Daviplata |
| BANCOLOMBIA_BNPL | PENDING | Redirect a formulario BNPL |
| SU_PLUS | PENDING | Redirect a formulario Su Plus |

---

## 6. Enlaces de Pago (Payment Links)

Los enlaces de pago permiten generar URLs de cobro sin necesidad de un checkout completo.

### Crear enlace de pago

```http
POST /v1/payment_links
Authorization: Bearer {private_key}
Content-Type: application/json
```

**Body:**

```json
{
  "name": "Producto XYZ",
  "description": "Descripción del producto",
  "single_use": true,
  "collect_shipping": false,
  "amount_in_cents": 5000000,
  "currency": "COP",
  "expires_at": "2025-12-31T23:59:59Z",
  "redirect_url": "https://mitienda.com/confirm",
  "image_url": "https://mitienda.com/img/producto.jpg",
  "sku": "SKU-XYZ"
}
```

**Respuesta:**

```json
{
  "data": {
    "id": "12345",
    "name": "Producto XYZ",
    "active": true,
    "amount_in_cents": 5000000,
    "currency": "COP",
    "single_use": true,
    "expires_at": "2025-12-31T23:59:59Z",
    "redirect_url": "https://mitienda.com/confirm"
  }
}
```

### Consultar enlace de pago

```http
GET /v1/payment_links/{link_id}
Authorization: Bearer {public_key}
```

---

## 7. Firma de Integridad (Integrity Signature)

La firma de integridad garantiza que los parámetros del checkout no han sido manipulados.

### Fórmula

```
SHA-256(reference + amount_in_cents + currency + [expiration_time] + integrity_secret)
```

Los componentes se concatenan **sin separador** y se aplica SHA-256.

### Implementación

```typescript
import { createHash } from 'crypto';

function generateIntegritySignature(params: {
  reference: string;
  amountInCents: number;
  currency: string;
  integritySecret: string;
  expirationTime?: string;
}): string {
  const parts = [
    params.reference,
    String(params.amountInCents),
    params.currency,
  ];
  if (params.expirationTime) parts.push(params.expirationTime);
  parts.push(params.integritySecret);

  return createHash('sha256')
    .update(parts.join(''))
    .digest('hex');
}
```

### Ejemplo

```
reference:       "ORD-12345"
amount_in_cents:  5000000
currency:         "COP"
integrity_secret: "test_integrity_abc123"

Concatenado:  "ORD-123455000000COPtest_integrity_abc123"
SHA-256:      "a1b2c3d4e5f6..."
```

> ⚠️ El monto SIEMPRE va en centavos y como string sin decimales.

---

## 8. Webhooks – Eventos

Los webhooks son **obligatorios** para transacciones asíncronas (NEQUI, PSE, Bancolombia, Daviplata) y recomendados para todas.

### 8.1 Configuración

1. En el Dashboard de Wompi → Configurar **URL de eventos**
2. Para sandbox y producción, configurar URLs separadas
3. Ejemplo: `https://api.tuapp.com/webhooks/wompi`

### 8.2 Estructura del evento

```json
{
  "event": "transaction.updated",
  "data": {
    "transaction": {
      "id": "12345-67890-abcdef",
      "status": "APPROVED",
      "amount_in_cents": 5000000,
      "reference": "ORD-12345",
      "payment_method_type": "NEQUI",
      "currency": "COP"
    }
  },
  "sent_at": "2025-01-15T10:35:00.000Z",
  "timestamp": 1705312500,
  "signature": {
    "properties": [
      "transaction.id",
      "transaction.status",
      "transaction.amount_in_cents",
      "transaction.reference"
    ],
    "checksum": "A1B2C3D4E5F6..."
  },
  "environment": "test"
}
```

### 8.3 Verificación de firma del webhook

Fórmula: concatenar los valores de las propiedades indicadas en `signature.properties` (en orden) + `timestamp` + `events_secret`, y calcular SHA-256.

```typescript
import { createHash } from 'crypto';

function verifyWebhookSignature(
  payload: {
    data: Record<string, unknown>;
    signature: {
      properties: string[];
      checksum: string;
      timestamp: number;
    };
  },
  eventsSecret: string
): boolean {
  const { properties, checksum, timestamp } = payload.signature;

  // Resolver valores de las propiedades (notación punto: transaction.id)
  const values = properties.map((prop) => {
    const keys = prop.split('.');
    let value: unknown = payload.data;
    for (const key of keys) {
      value = (value as Record<string, unknown>)?.[key];
    }
    return String(value ?? '');
  });

  // Concatenar valores + timestamp + events_secret
  const concatenated = values.join('') + String(timestamp) + eventsSecret;

  const computed = createHash('sha256')
    .update(concatenated)
    .digest('hex');

  // Comparación timing-safe para evitar timing attacks
  const computedBuf = Buffer.from(computed, 'hex');
  const checksumBuf = Buffer.from(checksum, 'hex');
  if (computedBuf.length !== checksumBuf.length) return false;
  return crypto.timingSafeEqual(computedBuf, checksumBuf);
}
```

### 8.4 Eventos disponibles

| Evento | Descripción |
|--------|-------------|
| `transaction.updated` | Cambio de estado de una transacción (APPROVED, DECLINED, VOIDED, ERROR) |
| `financial_obligation.updated` | Actualización de obligación financiera (para BNPL) |

### 8.5 Estados de transacción

| Estado | Descripción | Acción recomendada |
|--------|-------------|-------------------|
| `PENDING` | En proceso, esperando acción del usuario | No actualizar orden, esperar webhook |
| `APPROVED` | Pago exitoso | Marcar orden como pagada |
| `DECLINED` | Pago rechazado | Marcar orden como fallida, liberar stock |
| `VOIDED` | Transacción anulada | Revertir orden si estaba aprobada |
| `ERROR` | Error en el procesamiento | Loguear y notificar |

### 8.6 Endpoint de webhook (ejemplo NestJS)

```typescript
@Controller('webhooks/wompi')
export class WompiWebhookController {
  @Post()
  async handleWebhook(@Body() body: any) {
    // 1. Verificar firma SIEMPRE
    if (!this.verifySignature(body)) {
      // ⚠️ Retornar 200 igualmente (Wompi reintentaría si recibe error)
      return { received: true };
    }

    // 2. Solo procesar transaction.updated
    if (body.event !== 'transaction.updated') {
      return { received: true };
    }

    const txn = body.data.transaction;

    // 3. Extraer referencia para identificar la orden
    const reference = txn.reference; // ej: "ORD-12345"

    // 4. Procesar según estado
    switch (txn.status) {
      case 'APPROVED':
        await this.handleApproved(reference, txn);
        break;
      case 'DECLINED':
      case 'ERROR':
      case 'VOIDED':
        await this.handleDeclined(reference, txn);
        break;
      default:
        // PENDING u otro estado: ignorar
        break;
    }

    // 5. Siempre retornar 200
    return { received: true };
  }
}
```

### 8.7 Regla crítica: siempre retornar HTTP 200

Wompi reintenta el webhook si recibe un status != 200. Esto puede causar **procesamiento duplicado**. Siempre retorna 200, incluso si la firma es inválida (solo loguea el error).

---

## 9. Métodos de Pago Soportados

### Colombia (COP)

| Método | Tipo | Sincronía | Requiere webhook |
|--------|------|-----------|-----------------|
| Tarjeta crédito/débito | `CARD` | Sí (si no hay 3DS) / Async (3DS) | Recomendado |
| NEQUI | `NEQUI` | Asíncrono | **Sí** |
| PSE | `PSE` | Asíncrono (redirect) | **Sí** |
| Bancolombia Transfer | `BANCOLOMBIA_TRANSFER` | Asíncrono (redirect) | **Sí** |
| Bancolombia Collect | `BANCOLOMBIA_COLLECT` | Asíncrono | **Sí** |
| Bancolombia QR | `BANCOLOMBIA_QR` | Asíncrono | **Sí** |
| Bancolombia BNPL | `BANCOLOMBIA_BNPL` | Asíncrono (redirect) | **Sí** |
| Daviplata | `DAVIPLATA` | Asíncrono | **Sí** |
| Su Plus | `SU_PLUS` | Asíncrono (redirect) | **Sí** |
| PCOL | `PCOL` | Asíncrono | **Sí** |

### El Salvador (USD) – Wompi SV

| Método | Tipo |
|--------|------|
| Tarjeta crédito/débito | `CARD` |
| Puntos Agricola | `PUNTOS_AGRICOLA` |
| Bitcoin | `BTC` |
| QuickPay | `QUICKPAY` |

> La API de El Salvador tiene endpoints y flujos diferentes. Ver [docs.wompi.sv](https://docs.wompi.sv).

---

## 10. Flujos de Integración Recomendados

### 10.1 E-commerce (Widget Checkout) – Más simple

```
┌────────────┐    redirect     ┌──────────────┐    webhook     ┌────────────┐
│  Tu tienda  │ ─────────────> │ Wompi hosted  │ ─────────────> │ Tu backend │
│  (frontend) │                │  checkout     │                │            │
│             │ <───────────── │              │                │            │
│             │  redirect back │              │                │            │
└────────────┘                └──────────────┘                └────────────┘

Pasos:
1. Backend genera firma de integridad + URL de checkout
2. Frontend redirige al usuario a checkout.wompi.co
3. Usuario paga en Wompi
4. Wompi envía webhook transaction.updated
5. Backend verifica firma, actualiza orden
6. Wompi redirige al usuario de vuelta
7. Frontend consulta estado de la orden
```

### 10.2 POS / App nativa (API REST directa) – Más control

```
┌────────────┐                 ┌──────────────┐               ┌────────────┐
│ POS / App   │ ──────────────> │  Tu backend   │ ────────────> │  Wompi API  │
│             │                 │               │               │            │
│             │ <────────────── │               │ <──────────── │            │
│             │  nextAction     │               │  transacción  │            │
│             │                 │               │               │            │
│             │  [Si redirect]  │               │               │            │
│             │ ──────────────────────────────────────────────> │            │
│             │  Redirect al banco / 3DS                       │            │
│             │ <────────────────────────────────────────────── │            │
│             │                 │               │  webhook     │            │
│             │                 │ <──────────── │               │            │
└────────────┘                 └──────────────┘               └────────────┘

Pasos:
1. Backend obtiene acceptance tokens (cacheados)
2. Frontend envía datos de pago (método + info)
3. Backend genera referencia + firma de integridad
4. Backend crea transacción vía POST /transactions
5. Según nextAction: redirect, await, 3ds, o none
6. Webhook confirma estado final asíncrono
```

### 10.3 Payment Links (Enlaces de Pago) – Sin frontend

```
1. Backend crea enlace vía POST /payment_links
2. Se comparte la URL del enlace (email, WhatsApp, QR)
3. Usuario paga en la página de Wompi
4. Webhook confirma el pago
```

---

## 11. Repositorios de Referencia

Repositorios públicos que implementan integración Wompi y sirven como referencia:

| Repo | Stack | Estrellas | Descripción |
|------|-------|-----------|-------------|
| [saulmoralespa/payment-integration-wompi](https://github.com/saulmoralespa/payment-integration-wompi) | WordPress/PHP | ★5 | Plugin WordPress para pasarela Wompi |
| [mantissaio/medusa-payment-wompi](https://github.com/mantissaio/medusa-payment-wompi) | MedusaJS/Node | ★3 | Provider de Wompi SV para Medusa v2. Enlaces de pago + HMAC webhooks |
| [juanfer2/wompi-3ds-components](https://github.com/juanfer2/wompi-3ds-components) | Angular/TS | ★3 | Componentes para 3DS con Wompi |
| [CaPerez17/essentia-store](https://github.com/CaPerez17/essentia-store) | Next.js 14/Prisma | ★0 | E-commerce completo: Web Checkout, firma integridad, webhooks con verificación SHA-256, idempotencia |
| [arnaldo10cisne/materia_shop](https://github.com/arnaldo10cisne/materia_shop) | NestJS/React/AWS CDK | ★1 | Serverless con Lambda, Wompi API para pagos |
| [DonEdgarpai/kiyomi-ecommerce-backend-showcase](https://github.com/DonEdgarpai/kiyomi-ecommerce-backend-showcase) | Express/TypeORM/DDD | ★0 | Clean Architecture: Double-check pattern, HMAC, pessimistic locking |
| [Cristian-David-Github/medusa-payment-wompi-col](https://github.com/Cristian-David-Github/medusa-payment-wompi-col) | MedusaJS/Node | ★2 | Integración Wompi Colombia para Medusa |
| [IGedeon/laravel-wompi](https://github.com/IGedeon/laravel-wompi) | Laravel 12 | ★0 | Package Laravel: payment links, widget, transactions, webhooks |
| [mejia-jose/PaymentInOnlineStoreBackend](https://github.com/mejia-jose/PaymentInOnlineStoreBackend) | NestJS | ★1 | Backend NestJS que consume API Wompi en modo sandbox |
| [esarmiem/navegantes-payment-e-learning](https://github.com/esarmiem/navegantes-payment-e-learning) | Next.js/Supabase | ★1 | E-learning con Wompi como pasarela |

### Patrones comunes encontrados

1. **Firma de integridad con SHA-256**: Todos los repos que usan Widget/Web Checkout implementan la firma con la misma fórmula
2. **Verificación de webhook con events_secret**: Concatenación de properties + timestamp + secret
3. **Siempre retornar 200 al webhook**: Incluso en error, para evitar reintentos
4. **Idempotencia**: Los mejores repos usan `reference` única para evitar doble procesamiento
5. **Double-check pattern**: Kiyomi verifica firma HMAC + monto + consulta API antes de confirmar
6. **Cache de acceptance tokens**: TTL de 5 minutos para evitar llamadas repetidas

---

## 12. Seguridad y Buenas Prácticas

### Obligatorio

- **Nunca** expongas la private key en el frontend
- **Siempre** verifica la firma del webhook con `events_secret`
- **Siempre** retorna HTTP 200 al webhook (loguea errores internamente)
- Usa **SHA-256 timing-safe comparison** para verificar checksums
- Valida que el **monto del webhook coincida** con el monto esperado de la orden
- Genera **referencias únicas** por transacción (evitar replay)

### Recomendado

- Implementa **idempotencia** en el procesamiento de webhooks (usa `transaction.id` como idempotency key)
- **Cachéa** los acceptance tokens con TTL de 5 minutos
- Implementa **double-check**: tras recibir webhook APPROVED, consulta `GET /transactions/{id}` para confirmar
- Para producción, usa el **patrón de reserva de stock** con expiración mientras el pago está pendiente
- Loguea **todos** los webhooks recibidos (incluyendo los que fallan verificación) para debugging

### Manejo de concurrencia

```typescript
// Patrón: procesar webhook solo si la orden está en estado esperado
const order = await prisma.order.findUnique({ where: { code: orderCode } });

if (order.status === 'PAID') {
  // Ya procesada, idempotente: retornar OK
  return { received: true };
}

if (order.status !== 'PAYMENT_PENDING') {
  // Estado inesperado, loguear pero no procesar
  return { received: true };
}

// Procesar solo si está en PAYMENT_PENDING
await prisma.order.update({
  where: { id: order.id },
  data: { status: 'PAID' },
});
```

---

## 13. Troubleshooting

| Problema | Causa | Solución |
|----------|-------|----------|
| Firma de integridad inválida | Orden incorrecto de concatenación | Seguir: reference + amount + currency + [expiry] + secret, SIN separadores |
| Webhook no llega | URL mal configurada o no expuesta | Verificar URL en Dashboard, usar ngrok en local |
| Mismatch de firma webhook | Properties en otro orden o encoding | Wompi envía `signature.properties` con el orden exacto a usar |
| Transacción PSE queda en PENDING | El usuario no completó en el banco | Esperar webhook; timeout típico: 30 min |
| Error 401 en API | Private key incorrecta | Verificar prefijo `prv_test_` / `prv_prod_` según ambiente |
| Checkout muestra monto incorrecto | Amount no está en centavos | Enviar `amount_in_cents`: $50,000 COP → `5000000` |
| Sandbox no simula webhooks | Sandbox no envía webhooks reales | Simular manualmente o usar test mode de Wompi |
| CVV 111 en sandbox | Rechazo simulado | En sandbox, CVV `111` simula rechazo |

---

## Referencias Oficiales

- [Documentación Wompi Colombia](https://docs.wompi.co)
- [API Reference (Swagger)](https://production.wompi.co/v1)
- [Dashboard Comercios](https://comercios.wompi.co)
- [Panel Wompi](https://panel.wompi.co)
- [Documentación Wompi El Salvador](https://docs.wompi.sv)
- [API Wompi SV (Swagger)](https://api.wompi.sv/index.html)
