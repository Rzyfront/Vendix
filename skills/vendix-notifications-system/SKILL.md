---
name: vendix-notifications-system
description: >
  Store notifications system: database notifications, SSE stream, Web Push/VAPID, subscriptions, and frontend NgRx integration.
  Trigger: When adding notification types, modifying SSE/Web Push delivery, notification preferences, or notification UI.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding or modifying notification types"
    - "Working with notifications SSE or Web Push"
    - "Updating notification subscriptions or notification preferences"
    - "Working on notifications dropdown or bell badge UI"
---

# Vendix Notifications System

## Purpose

Use this skill for full-stack store notifications: persisted notification rows, SSE live stream, Web Push browser notifications, and notification preferences.

## Current Architecture

`NotificationsService.createAndBroadcast(...)` is the hub:

1. Creates a row in `notifications` using `GlobalPrismaService`.
2. Broadcasts to connected store users through `NotificationsSseService`.
3. Sends Web Push through `NotificationsPushService`.
4. Catches/logs errors so notification failures do not break the business flow.

## Delivery Channels

| Channel | Behavior |
| --- | --- |
| REST list/unread | Store-scoped persisted notifications |
| SSE | One `Subject` per `store_id`; every connected user for that store receives events |
| Web Push | Browser push via VAPID and `push_subscriptions`; filtered by `notification_subscriptions.in_app` |
| Email/WhatsApp preferences | Stored in `notification_subscriptions`, not used by generic notification delivery |

## Backend Files

- `apps/backend/src/domains/store/notifications/notifications.controller.ts`
- `apps/backend/src/domains/store/notifications/notifications.service.ts`
- `apps/backend/src/domains/store/notifications/notifications-sse.service.ts`
- `apps/backend/src/domains/store/notifications/notifications-push.service.ts`
- `apps/backend/src/domains/store/notifications/notifications-events.listener.ts`
- `apps/backend/src/domains/store/notifications/dto/update-subscription.dto.ts`
- `apps/backend/src/domains/store/notifications/dto/push-subscription.dto.ts`

## Frontend Files

- `apps/frontend/src/app/core/services/notifications.service.ts`
- `apps/frontend/src/app/core/services/push-subscription.service.ts`
- `apps/frontend/src/app/core/store/notifications/*`
- `apps/frontend/src/app/shared/components/notifications-dropdown/notifications-dropdown.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/components/notifications-settings-form/notifications-settings-form.component.ts`
- `apps/frontend/public/push-sw.js`

## API Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/store/notifications` | List notifications |
| GET | `/store/notifications/unread-count` | Unread count |
| PATCH | `/store/notifications/:id/read` | Mark one read; skips subscription gate |
| PATCH | `/store/notifications/read-all` | Mark all read; skips subscription gate |
| GET | `/store/notifications/subscriptions` | Read/init notification preferences |
| PATCH | `/store/notifications/subscriptions` | Update notification preferences |
| GET | `/store/notifications/stream?token=JWT` | SSE stream; token in query because EventSource has no custom headers |
| GET | `/store/notifications/push/vapid-key` | Public VAPID key |
| PATCH | `/store/notifications/push/subscribe` | Save browser push subscription |
| PATCH | `/store/notifications/push/unsubscribe` | Remove browser push subscription |

## Prisma Reality

- `notifications` has `store_id`, `type`, `severity`, `title`, `body`, `data`, `is_read`; no `user_id`.
- `notification_subscriptions` has `store_id`, `user_id`, `type`, `in_app`, `email`, `whatsapp`.
- `push_subscriptions` stores browser endpoints and keys per `store_id`, `user_id`, and endpoint.
- `notification_type_enum` is the source of valid types. Listener-emitted types must exist in this enum.

## Adding A Notification Type

1. Add the type to `notification_type_enum` through a safe Prisma migration.
2. Add or update event listener handling in `notifications-events.listener.ts`.
3. Ensure `createAndBroadcast(...)` receives a valid enum value.
4. Add default subscription/preferences if users should control the type.
5. Update frontend icon/label/rendering where needed.
6. Consider Web Push behavior; `in_app` preferences affect push delivery.

## Known Current Mismatches To Watch

- Some listener-emitted booking/data request types may not exist in `notification_type_enum`; those creates fail and are swallowed by `createAndBroadcast()`.
- `update-subscription.dto.ts` and default subscription initialization cover only a subset of enum values.
- SSE ignores per-user preferences; Web Push enforces `notification_subscriptions.in_app`.
- There is a subscription effects SSE consumer for `subscription.updated`; confirm backend emits that type before relying on it.

## Zoneless Frontend Rule

Angular 20 frontend effects use native `EventSource` callbacks without `NgZone.run()`. Do not reintroduce Zone.js patterns; follow `vendix-zoneless-signals`.

## Related Skills

- `vendix-zoneless-signals` - EventSource/NgRx frontend behavior
- `vendix-multi-tenant-context` - Store context and scoped operations
- `vendix-subscription-gate` - Store write gating and `@SkipSubscriptionGate`
- `vendix-prisma-migrations` - Adding enum values safely
