---
name: vendix-notifications-system
description: >
  Real-time notifications system: SSE streaming, event-driven creation, NgRx state, subscriptions, and extension guide.
  Trigger: When working with notifications, SSE connections, event listeners, or adding new notification types.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: [root]
  auto_invoke: "Working with notifications, SSE, or adding new event-driven alerts"
---

# Vendix Notifications System

> **Full-stack real-time notifications** - Event-driven backend (NestJS + EventEmitter + SSE) with NgRx-powered frontend (Angular).

---

## When to Use

- Adding a **new notification type** (e.g. `product_updated`, `refund_issued`)
- Modifying the **SSE streaming** pipeline or connection lifecycle
- Working on the **notifications dropdown** or bell badge UI
- Debugging **NgZone errors** related to SSE (EventSource runs outside Angular zone)
- Adding **email/SMS delivery** channels
- Implementing per-user **subscription filtering** (currently saved but not enforced)
- Understanding the notification data flow end-to-end

---

## Architecture Overview

```
                          BACKEND                                    FRONTEND
 ┌─────────────────────────────────────────────┐    ┌──────────────────────────────────────┐
 │                                             │    │                                      │
 │  Business Services                          │    │  NgRx Store                           │
 │  (checkout, payments, orders, customers,    │    │  ┌──────────────────────────────┐    │
 │   stock-level-manager)                      │    │  │ notifications.effects.ts      │    │
 │         │                                   │    │  │  init$ ─ ROOT_EFFECTS_INIT    │    │
 │         │ EventEmitter                      │    │  │  connectSse$ ─ EventSource    │    │
 │         ▼                                   │    │  │  load$ ─ HTTP GET             │    │
 │  NotificationsEventsListener                │    │  │  markRead$ / markAllRead$     │    │
 │  (@OnEvent handlers)                        │    │  └──────────┬───────────────────┘    │
 │         │                                   │    │             │                         │
 │         ▼                                   │    │             ▼                         │
 │  NotificationsService                       │    │  notifications.reducer.ts             │
 │  .createAndBroadcast(store_id, type, ...)   │    │  { items[], unread_count,             │
 │         │                                   │    │    sse_connected, loading }            │
 │    ┌────┴────┐                              │    │             │                         │
 │    │         │                              │    │             ▼                         │
 │    ▼         ▼                              │    │  NotificationsFacade                  │
 │  INSERT   SSE Push                          │    │  (providedIn: 'root')                 │
 │  (DB)   (Subject)                           │    │             │                         │
 │            │                                │    │             ▼                         │
 │            ▼                                │    │  NotificationsDropdownComponent        │
 │  NotificationsSseService                    │    │  (bell icon + badge + dropdown list)  │
 │  Map<store_id, Subject>                     │    │                                      │
 │            │                                │    └──────────────────────────────────────┘
 │            ▼                                │                    ▲
 │  @Sse('stream') endpoint ──── SSE ──────────┼────────────────────┘
 │  GET /store/notifications/stream?token=JWT  │    EventSource (native browser API)
 │                                             │
 └─────────────────────────────────────────────┘
```

---

## Critical Patterns

### 1. Notifications are Store-Scoped, NOT User-Scoped

The `notifications` table has **no `user_id` column**. All notifications belong to a `store_id`. When broadcast via SSE, **every user connected to that store** receives the notification.

```prisma
model notifications {
  id         Int                    @id @default(autoincrement())
  store_id   Int
  type       notification_type_enum
  title      String
  body       String
  data       Json?
  is_read    Boolean                @default(false)
  created_at DateTime               @default(now())
  updated_at DateTime               @updatedAt
  store      stores                 @relation(fields: [store_id], references: [id])

  @@index([store_id])
  @@index([store_id, is_read])
  @@index([store_id, created_at(sort: Desc)])
}
```

### 2. SSE Push is One Subject per Store

`NotificationsSseService` maintains `Map<number, Subject<SseNotificationPayload>>` keyed by `store_id`:

```typescript
// notifications-sse.service.ts
@Injectable()
export class NotificationsSseService {
  private subjects = new Map<number, Subject<SseNotificationPayload>>();

  getOrCreate(store_id: number): Subject<SseNotificationPayload> { ... }
  push(store_id: number, payload: SseNotificationPayload) { ... }
  removeStore(store_id: number) { ... }
}
```

### 3. EventSource Callbacks MUST Run Inside NgZone

`EventSource` is a native browser API. Its callbacks execute outside Angular Zone.js. NgRx's `strictActionWithinNgZone: true` will throw if actions are dispatched outside the zone.

```typescript
// notifications.effects.ts - ALWAYS wrap callbacks with NgZone
private ngZone = inject(NgZone);

this.eventSource.onopen = () => {
  this.ngZone.run(() => {
    observer.next(NotificationsActions.sseConnected());
  });
};
```

### 4. SSE Auth via Query Parameter (Not Headers)

`EventSource` does NOT support custom headers. The JWT is passed as `?token=<access_token>`:

```typescript
// Frontend: notifications.service.ts
getSseUrl(): string {
  const token = JSON.parse(localStorage.getItem('vendix_auth_state'))?.tokens?.access_token;
  return `${this.baseUrl}/stream?token=${token}`;
}
```

The backend `JwtStrategy` has `ExtractJwt.fromUrlQueryParameter('token')` as a fallback extractor to handle this.

### 5. createAndBroadcast Never Throws

The method wraps everything in try/catch and logs errors. Notification failures **never** break the primary business flow (orders, payments, etc.):

```typescript
async createAndBroadcast(store_id, type, title, body, data?) {
  try {
    const notification = await this.global_prisma.notifications.create({ ... });
    this.sse_service.push(store_id, { ... });
    return notification;
  } catch (error) {
    console.error(`[NotificationsService] Failed: ${error.message}`);
    return null; // Never throws
  }
}
```

### 6. Uses GlobalPrismaService for Creation

`createAndBroadcast` uses `GlobalPrismaService` (not `StorePrismaService`) because it is called from event listeners that may execute in ecommerce/customer contexts where the store-admin scoped Prisma service would fail.

---

## Notification Types (Enum)

```prisma
enum notification_type_enum {
  new_order
  order_status_change
  low_stock
  new_customer
  payment_received
}
```

| Type | Event | Emitted From | Icon (Frontend) |
|------|-------|-------------|-----------------|
| `new_order` | `order.created` | `checkout.service.ts`, `payments.service.ts`, `orders.service.ts` | `shopping-cart` |
| `order_status_change` | `order.status_changed` | `order-flow.service.ts` | `refresh-cw` |
| `low_stock` | `stock.low` | `stock-level-manager.service.ts` (when `qty <= reorder_point`) | `alert-triangle` |
| `new_customer` | `customer.created` | `customers.service.ts` | `user-plus` |
| `payment_received` | `payment.received` | `payments.service.ts` | `credit-card` |

---

## Backend File Map

```
apps/backend/src/domains/store/notifications/
├── notifications.module.ts              # NestJS module registration
├── notifications.controller.ts          # REST + SSE endpoints
├── notifications.service.ts             # CRUD + createAndBroadcast
├── notifications-sse.service.ts         # SSE Subject management
├── notifications-events.listener.ts     # @OnEvent handlers
├── dto/
│   ├── index.ts                         # Barrel exports
│   ├── notification-query.dto.ts        # Pagination + filters
│   └── update-subscription.dto.ts       # Per-user subscription toggle
└── interfaces/
    └── notification-events.interface.ts  # Event payload types + SseNotificationPayload
```

---

## Frontend File Map

```
apps/frontend/src/app/
├── core/
│   ├── services/
│   │   └── notifications.service.ts        # NotificationsApiService (HTTP + SSE URL)
│   └── store/notifications/
│       ├── index.ts                        # Barrel exports
│       ├── notifications.actions.ts        # NgRx actions + AppNotification interface
│       ├── notifications.reducer.ts        # State shape + reducers
│       ├── notifications.selectors.ts      # Memoized selectors
│       ├── notifications.effects.ts        # SSE connection + HTTP effects
│       └── notifications.facade.ts         # Simplified API for components
└── shared/components/
    └── notifications-dropdown/
        ├── notifications-dropdown.component.ts    # Bell + badge + dropdown UI
        └── notifications-dropdown.component.scss  # Styles
```

---

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/store/notifications` | List notifications (paginated, filterable) | JWT |
| `GET` | `/store/notifications/unread-count` | Get unread count | JWT |
| `PATCH` | `/store/notifications/:id/read` | Mark single as read | JWT |
| `PATCH` | `/store/notifications/read-all` | Mark all as read | JWT |
| `GET` | `/store/notifications/subscriptions` | Get user subscriptions (init defaults) | JWT |
| `PATCH` | `/store/notifications/subscriptions` | Toggle subscription per type | JWT |
| `GET (SSE)` | `/store/notifications/stream?token=JWT` | SSE real-time stream | JWT (query param) |

---

## Frontend NgRx State

### State Shape

```typescript
interface NotificationsState {
  items: AppNotification[];  // Max 50 in memory
  unread_count: number;
  loading: boolean;
  error: string | null;
  sse_connected: boolean;
}
```

### Effects Lifecycle

| Effect | Trigger | Action |
|--------|---------|--------|
| `init$` | `ROOT_EFFECTS_INIT` (page reload) | If authenticated → `loadNotifications` + `connectSse` |
| `initAfterLogin$` | `loginSuccess`, `loginCustomerSuccess`, `restoreAuthState` | `loadNotifications` + `connectSse` |
| `connectSse$` | `connectSse` | Opens `EventSource`, maps SSE events to NgRx actions |
| `disconnectSse$` | `disconnectSse`, `logoutSuccess` | Closes `EventSource` |
| `load$` | `loadNotifications` | HTTP GET → `loadNotificationsSuccess` |
| `markRead$` | `markRead` | HTTP PATCH → `markReadSuccess` |
| `markAllRead$` | `markAllRead` | HTTP PATCH → `markAllReadSuccess` |

### Selectors

| Selector | Returns |
|----------|---------|
| `selectNotifications` | `AppNotification[]` |
| `selectUnreadCount` | `number` |
| `selectNotificationsLoading` | `boolean` |
| `selectSseConnected` | `boolean` |
| `selectUnreadNotifications` | Filtered unread items |

### Facade (Recommended for Components)

```typescript
@Injectable({ providedIn: 'root' })
export class NotificationsFacade {
  notifications$ = this.store.select(selectNotifications);
  unreadCount$ = this.store.select(selectUnreadCount);
  loading$ = this.store.select(selectNotificationsLoading);
  sseConnected$ = this.store.select(selectSseConnected);

  loadNotifications() { ... }
  connectSse() { ... }
  disconnectSse() { ... }
  markRead(id: number) { ... }
  markAllRead() { ... }
}
```

---

## How-To Guides

### Add a New Notification Type

**Step 1: Update Prisma enum**

```prisma
// schema.prisma
enum notification_type_enum {
  new_order
  order_status_change
  low_stock
  new_customer
  payment_received
  refund_issued          // <-- NEW
}
```

Run migration: `npx prisma migrate dev --name add_refund_issued_notification`

**Step 2: Create event interface**

```typescript
// interfaces/notification-events.interface.ts
export interface RefundIssuedEvent {
  store_id: number;
  order_id: number;
  order_number: string;
  amount: number;
  currency: string;
  reason: string;
}
```

**Step 3: Emit event from business service**

```typescript
// In the service that handles refunds:
import { EventEmitter2 } from '@nestjs/event-emitter';

constructor(private readonly event_emitter: EventEmitter2) {}

async processRefund(order_id: number, amount: number) {
  // ... business logic ...

  this.event_emitter.emit('refund.issued', {
    store_id,
    order_id,
    order_number,
    amount,
    currency,
    reason,
  } satisfies RefundIssuedEvent);
}
```

**Step 4: Add event listener**

```typescript
// notifications-events.listener.ts
@OnEvent('refund.issued')
async handleRefundIssued(event: RefundIssuedEvent) {
  await this.notifications_service.createAndBroadcast(
    event.store_id,
    'refund_issued',
    'Reembolso Emitido',
    `Reembolso de $${event.amount} ${event.currency} para orden #${event.order_number}`,
    { order_id: event.order_id, reason: event.reason },
  );
}
```

**Step 5: Update DTO validation**

```typescript
// dto/update-subscription.dto.ts
const NOTIFICATION_TYPES = [
  'new_order',
  'order_status_change',
  'low_stock',
  'new_customer',
  'payment_received',
  'refund_issued',          // <-- ADD
] as const;
```

**Step 6: Update default subscriptions**

```typescript
// notifications.service.ts → initDefaultSubscriptions()
const types = [
  'new_order',
  'order_status_change',
  'low_stock',
  'new_customer',
  'payment_received',
  'refund_issued',          // <-- ADD
];
```

**Step 7: Add icon mapping in frontend**

```typescript
// notifications-dropdown.component.ts
getIconForType(type: string): string {
  const map: Record<string, string> = {
    new_order: 'shopping-cart',
    order_status_change: 'refresh-cw',
    low_stock: 'alert-triangle',
    new_customer: 'user-plus',
    payment_received: 'credit-card',
    refund_issued: 'rotate-ccw',       // <-- ADD (Lucide icon)
  };
  return map[type] ?? 'bell';
}
```

**Step 8: Update settings form** (if subscription toggles exist)

Add the new type to `notifications-settings-form.component.ts` subscription list.

---

### Add Per-User SSE Filtering (Future Enhancement)

Currently `notification_subscriptions` is saved but NOT enforced during delivery. To implement:

**Option A: Server-side filtering (Recommended)**

Change SSE from store-level to user-level Subjects:

```typescript
// notifications-sse.service.ts
// Change key from store_id to "storeId:userId"
private subjects = new Map<string, Subject<SseNotificationPayload>>();

getOrCreate(store_id: number, user_id: number): Subject<SseNotificationPayload> {
  const key = `${store_id}:${user_id}`;
  if (!this.subjects.has(key)) {
    this.subjects.set(key, new Subject());
  }
  return this.subjects.get(key)!;
}

// In createAndBroadcast: query subscriptions, only push to users with in_app: true
async pushFiltered(store_id: number, type: string, payload: SseNotificationPayload) {
  const subs = await this.prisma.notification_subscriptions.findMany({
    where: { store_id, type, in_app: true },
  });
  for (const sub of subs) {
    const key = `${store_id}:${sub.user_id}`;
    const subject = this.subjects.get(key);
    if (subject && !subject.closed) subject.next(payload);
  }
}
```

**Option B: Client-side filtering (Quick but less efficient)**

Filter in the NgRx effect based on user preferences loaded at init time.

---

### Add Email Delivery Channel (Future Enhancement)

The `email` boolean on `notification_subscriptions` is stored but never acted on. To implement:

1. Create an `EmailNotificationsService` with a mail transport (e.g. `@nestjs-modules/mailer`, SES, SendGrid)
2. In `createAndBroadcast`, after the SSE push, query subscriptions with `email: true`
3. For each matching user, send the notification email
4. Consider using a queue (Bull/BullMQ) to avoid blocking the main flow

---

## Nginx / Reverse Proxy Requirements (Production)

SSE requires a **dedicated location block** separate from the general API. SSE is NOT WebSocket — it is plain HTTP with `Content-Type: text/event-stream`. Do NOT use WebSocket upgrade headers for SSE.

```nginx
# nginx.conf - backend server block (api.vendix.online)

# SSE endpoint — MUST come BEFORE the general location /
location /api/store/notifications/stream {
    proxy_pass http://vendix_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection '';          # No upgrade — SSE is plain HTTP
    proxy_buffering off;                     # CRITICAL: stream events immediately
    proxy_cache off;                         # Never cache SSE
    chunked_transfer_encoding off;           # Prevent chunked encoding issues
    proxy_read_timeout 86400s;               # 24h — prevents 504 on idle connections
    proxy_send_timeout 86400s;               # 24h — same for send direction
}

# General API (REST + WebSocket)
location / {
    proxy_pass http://vendix_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;  # WebSocket upgrade support
    proxy_buffering off;
    proxy_cache off;
}
```

### SSE vs WebSocket — Why Different Config

| | SSE | WebSocket |
|--|-----|-----------|
| Protocol | Plain HTTP | Upgraded HTTP |
| `Connection` header | `''` (empty — keep-alive) | `$connection_upgrade` (upgrade) |
| `Upgrade` header | Not needed | Required |
| `proxy_read_timeout` | Long (86400s) — no data may flow for minutes | Default (60s) — pings keep it alive |
| `chunked_transfer_encoding` | `off` — prevents buffering artifacts | Default |

### Why Each SSE Directive Matters

| Directive | Why it's needed |
|-----------|----------------|
| `proxy_buffering off` | Without this, Nginx accumulates SSE events in a buffer and sends them in batches instead of streaming |
| `proxy_cache off` | Cached SSE responses would deliver stale events |
| `Connection ''` | Tells Nginx to use plain HTTP keep-alive. Using `$connection_upgrade` would attempt WebSocket upgrade which SSE does not use |
| `chunked_transfer_encoding off` | Prevents Nginx from wrapping SSE in chunked encoding, which can cause `ERR_INCOMPLETE_CHUNKED_ENCODING` |
| `proxy_read_timeout 86400s` | Default is 60s — Nginx sends 504 if no SSE event arrives within that window |
| `proxy_send_timeout 86400s` | Matches read timeout for the send direction |

### Common Errors

**`504 Gateway Timeout` after ~60s of no notifications:**
Cause: `proxy_read_timeout` is at default (60s). Fix: Set to `86400s` in SSE location.

**`ERR_INCOMPLETE_CHUNKED_ENCODING`:**
Cause: `proxy_buffering` is on (default) or `chunked_transfer_encoding` is not disabled. Fix: Add both `proxy_buffering off` and `chunked_transfer_encoding off`.

### AWS Infrastructure Notes

- **CloudFront**: Vendix frontend is served via CloudFront → S3. The API (`api.vendix.online`) points directly to EC2 via A record — CloudFront is NOT in the SSE path
- **Security Groups**: No idle timeout on TCP connections (stateful)
- **No NAT Gateway**: EC2 is in a public subnet with Internet Gateway — no 350s TCP idle timeout concern

---

## Known Limitations & Gaps

| Item | Status | Notes |
|------|--------|-------|
| `notification_subscriptions` enforcement | **Not implemented** | Preferences saved but ignored during delivery |
| Email delivery | **Not implemented** | `email` boolean stored, no transport configured |
| SMS delivery | **Not implemented** | Phone fields in store settings, no provider |
| Per-user targeting | **Not implemented** | All store users receive all notifications |
| Notification persistence limit | 50 in-memory (frontend) | Older items dropped from NgRx state, still in DB |
| SSE reconnection | **Auto (EventSource)** | Native auto-reconnect; effect does not complete observable on error |

---

## Event Interfaces Reference

```typescript
// interfaces/notification-events.interface.ts

interface OrderCreatedEvent {
  store_id: number;
  order_id: number;
  order_number: string;
  customer_name?: string;
  grand_total: number;
  currency: string;
}

interface OrderStatusChangedEvent {
  store_id: number;
  order_id: number;
  order_number: string;
  old_state: string;
  new_state: string;
}

interface PaymentReceivedEvent {
  store_id: number;
  order_id: number;
  order_number: string;
  amount: number;
  currency: string;
  payment_method: string;
}

interface NewCustomerEvent {
  store_id: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  email: string;
}

interface LowStockEvent {
  store_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  threshold: number;
}

interface SseNotificationPayload {
  id: number;
  type: string;
  title: string;
  body: string;
  data?: any;
  created_at: string;
}
```

---

## Commands

```bash
# Generate migration after adding new notification type to enum
npx prisma migrate dev --name add_<type>_notification

# Check SSE endpoint manually (replace token)
curl -N "http://localhost:3000/store/notifications/stream?token=YOUR_JWT"

# Verify frontend build
docker logs --tail 40 vendix_frontend
```

---

## Related Skills

- `vendix-backend-domain` - Backend domain architecture and module patterns
- `vendix-frontend-state` - NgRx and service state management
- `vendix-prisma-scopes` - Multi-tenant scoping (why GlobalPrismaService is used for creation)
- `vendix-multi-tenant-context` - Request context and AsyncLocalStorage
- `vendix-frontend-icons` - Lucide icon registration for notification type icons
- `vendix-settings-system` - Store settings where notification email/SMS config is stored
