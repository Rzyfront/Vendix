---
name: vendix-payment-processors
description: >
  Payment processor system: Strategy pattern, multi-tenant credentials, webhook routing, and how to add new payment gateways.
  Trigger: When adding new payment processors, modifying payment flows, working with webhooks, or understanding the payment architecture.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [backend, frontend]
  auto_invoke: "Adding new payment processors, modifying payment gateway logic, working with payment webhooks"
---

## When to Use

- Adding a new payment gateway (e.g., MercadoPago, Stripe Connect)
- Modifying the payment processing flow (POS or eCommerce)
- Working with payment webhooks
- Understanding how multi-tenant payment credentials work
- Debugging payment-related issues

---

## Architecture Overview

```
system_payment_methods (DB)          Global catalog of available methods
        |
store_payment_methods (DB)           Per-tenant activation + encrypted credentials
        |
PaymentsModule (NestJS)              Registers all processors on init
        |
PaymentGatewayService                Strategy router: type string → processor instance
        |
BasePaymentProcessor (abstract)      Common interface all processors implement
        |
    ┌───┴───────┬──────────┬────────────┬──────────┐
  Cash      Stripe     PayPal    BankTransfer    Wompi
```

---

## Critical Patterns

### 1. Processor Registration (Strategy Pattern)

Every processor extends `BasePaymentProcessor` and is registered in `PaymentsModule.onModuleInit()`:

```
File: apps/backend/src/domains/store/payments/payments.module.ts

onModuleInit() {
  this.paymentGateway.registerProcessor('cash', this.cashProcessor);
  this.paymentGateway.registerProcessor('card', this.stripeProcessor);
  this.paymentGateway.registerProcessor('wompi', this.wompiProcessor);
  // ... etc
}
```

The gateway resolves the processor by `system_payment_methods.type`:

```
File: apps/backend/src/domains/store/payments/services/payment-gateway.service.ts

const processor = this.getProcessor(paymentMethod.system_payment_method?.type);
```

### 2. Multi-Tenant Credentials

Each store has its OWN credentials stored in `store_payment_methods.custom_config` (JSON, encrypted at rest):

```
store_payment_methods
├── store_id: 5
├── system_payment_method_id: 7  (→ type: 'wompi')
├── custom_config: { public_key: "enc:...", private_key: "enc:...", ... }
└── state: 'enabled'
```

- **Encryption**: `PaymentEncryptionService` (AES-256-GCM) encrypts sensitive fields on save
- **Decryption**: `StorePaymentMethodsService.getDecryptedConfig(id)` for internal use
- **Masking**: API responses show `****last4` via `maskConfig()`
- **Sensitive keys per provider**: defined in `SENSITIVE_CONFIG_KEYS` map

### 3. POS vs eCommerce Payment Flows

| Aspect | POS | eCommerce |
|--------|-----|-----------|
| Entry point | `POST /store/payments/pos` | `POST /ecommerce/checkout` |
| Order creation | Inside `$transaction()` | Inside checkout service |
| Payment timing | Direct (cash/card) or post-commit (digital) | After order via Widget or redirect |
| Digital methods | Processed AFTER transaction commit | Widget handles externally |
| Auth | JWT (admin/staff) | JWT (customer) or guest |

**Critical rule for POS digital payments (Wompi/wallet):**
- Order created and committed FIRST inside `$transaction()`
- Payment processed AFTER commit (order visible to regular Prisma client)
- If payment fails, order state reverted to `created`

### 4. Webhook Flow

```
Wompi/Stripe/PayPal sends POST → /store/webhooks/{processor}
        |
WebhookController validates signature (per-tenant secret)
        |
WebhookHandlerService routes to handleXxxWebhook()
        |
Updates payment state + order state (uses withoutScope())
```

- Webhooks arrive WITHOUT tenant context — storeId extracted from transaction reference
- ALL webhook queries use `prisma.withoutScope()` (no tenant scoping)
- Wompi webhook MUST return HTTP 200 even on validation failure (retry policy)

### 5. Config Schema System

Each `system_payment_methods` record has a `config_schema` (JSON Schema) that defines what credentials the store admin must provide:

```json
{
  "type": "object",
  "required": ["public_key", "private_key"],
  "properties": {
    "public_key": { "type": "string", "title": "Public Key" },
    "private_key": { "type": "string", "format": "password" }
  }
}
```

- Frontend renders dynamic forms from this schema
- Backend validates config against per-provider DTO validators (`validators/` directory)

---

## How to Add a New Payment Processor

### Step 1: Create processor files

```
apps/backend/src/domains/store/payments/processors/{name}/
├── {name}.module.ts
├── {name}.client.ts        (API client for the gateway)
├── {name}.processor.ts     (extends BasePaymentProcessor)
└── {name}.types.ts          (request/response interfaces)
```

### Step 2: Implement the processor

```typescript
// {name}.processor.ts
export class NewProcessor extends BasePaymentProcessor {
  async processPayment(paymentData: PaymentData): Promise<PaymentResult> { ... }
  async refundPayment(paymentId: string, amount?: number): Promise<RefundResult> { ... }
  async validatePayment(paymentData: PaymentData): Promise<boolean> { ... }
  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> { ... }
  async validateWebhook(signature: string, body: string): Promise<boolean> { ... }
}
```

**PaymentResult must include:**
- `success`, `status`, `transactionId`, `gatewayResponse`
- `nextAction: { type: 'redirect' | 'await' | '3ds' | 'none', url?, data? }`

### Step 3: Register in PaymentsModule

```typescript
// payments.module.ts
imports: [..., NewProcessorModule],
// In constructor: private newProcessor: NewProcessor
// In onModuleInit():
this.paymentGateway.registerProcessor('new_type', this.newProcessor);
```

### Step 4: Add system payment method seed

```typescript
// prisma/seeds/system-payment-methods.seed.ts
{
  name: 'new_gateway',
  display_name: 'New Gateway',
  type: 'new_type',
  provider: 'new_provider',
  requires_config: true,
  config_schema: { ... },
  processing_mode: 'ONLINE',
}
```

### Step 5: Add enum value

```prisma
// schema.prisma
enum payment_methods_type_enum {
  // ... existing
  new_type
}
```

Migration: `npx prisma migrate dev --name add_new_type_payment`

### Step 6: Add webhook endpoint (if needed)

```typescript
// webhook.controller.ts
@Post('new-gateway')
async handleNewGatewayWebhook(@Body() body: any, @Headers('x-signature') sig: string) {
  // Validate signature, create WebhookEvent, handle
}
```

### Step 7: Add config validator

```typescript
// validators/new-config.validator.ts
export class NewConfigValidator {
  @IsString() @IsNotEmpty() api_key: string;
  @IsString() @IsNotEmpty() secret_key: string;
}
```

Register in `config-validator.registry.ts`.

### Step 8: Add sensitive keys for encryption

```typescript
// services/payment-encryption.service.ts
const SENSITIVE_CONFIG_KEYS = {
  // ... existing
  new_type: ['secret_key', 'webhook_secret'],
};
```

### Step 9: Frontend (if async/digital method)

For POS: add sub-method UI in `pos-payment-interface.component.ts/html`
For eCommerce: typically use the gateway's own Widget/redirect (like Wompi Widget)

---

## Key Interfaces

```typescript
// PaymentData — input to processor
interface PaymentData {
  orderId: number;
  customerId?: number;
  amount: number;
  currency: string;
  storePaymentMethodId: number;
  storeId: number;
  metadata?: Record<string, any>;  // includes credentials, sub-method data
  returnUrl?: string;
}

// PaymentResult — output from processor
interface PaymentResult {
  success: boolean;
  transactionId?: string;
  status: payments_state_enum;
  message?: string;
  gatewayResponse?: any;
  nextAction?: {
    type: 'redirect' | '3ds' | 'await' | 'none';
    url?: string;
    data?: any;
  };
}

// WebhookEvent — from controller to handler
interface WebhookEvent {
  processor: string;
  eventType: string;
  data: any;
  signature?: string;
  rawBody?: string;
  storeId?: number;
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `payments.module.ts` | Registers all processors |
| `payment-gateway.service.ts` | Strategy router + payment record CRUD |
| `base-processor.interface.ts` | Abstract class all processors extend |
| `payment-processor.interface.ts` | PaymentData, PaymentResult, WebhookEvent types |
| `payment-validator.service.ts` | Validates order, method, amount, currency |
| `payment-encryption.service.ts` | AES-256-GCM encrypt/decrypt/mask credentials |
| `store-payment-methods.service.ts` | CRUD for per-tenant payment config |
| `webhook.controller.ts` | Routes webhooks to handler |
| `webhook-handler.service.ts` | Processes webhook events, updates payment/order |
| `validators/config-validator.registry.ts` | Maps type → validator class |
| `processors/{name}/` | Each processor in its own directory |

---

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Webhook queries fail with ForbiddenException | Use `prisma.withoutScope()` — webhooks have no tenant context |
| POS digital payment "Order not found" | Process payment AFTER `$transaction` commit, not inside it |
| Credentials exposed in API response | Use `maskConfig()` in service, never return raw `custom_config` |
| Acceptance tokens called per transaction | Cache tokens with TTL (Wompi uses 5min Map cache) |
| Frontend form values don't reach FormGroup | Use `formControlName` directive, not `[control]` input |

---

## Related Skills

- `vendix-backend` — General NestJS patterns
- `vendix-prisma-scopes` — Multi-tenant scoping with StorePrismaService
- `vendix-multi-tenant-context` — How store context is resolved
- `vendix-frontend-component` — Shared component usage rules
- `vendix-frontend-icons` — Icon registration for payment UI
