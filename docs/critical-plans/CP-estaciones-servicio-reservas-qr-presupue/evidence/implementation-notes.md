# Implementation notes and open verification

Detailed status retained from step handoffs. These notes are not acceptance evidence.

## B.3

Reserva/walk-in persisten el email disponible o capturado; token se genera en la transacción, y correo/reemisión verificada tienen estado idempotente. Al iniciar desde una orden existente, sus líneas quedan enlazadas a la sesión para cumplir el FK compuesto. A.1 mantiene preferencias económicas/consentimiento como supuestos y falta validar expiración/concurrencia en runtime.

## B.4

Los escritores de orden y cobro identificados validan moneda/tope, fallan cerrados si la sesión no tiene presupuesto y las rutas sensibles de pago revalidan junto con el alta del pago pendiente o bajo el lock/claim correspondiente. El límite no puede cambiar con pago pendiente y las cancelaciones de línea incrementan `service_version`. Falta terminar el barrido de todos los mutadores de líneas/totales, definir si la propuesta representa adiciones o el nuevo total (incluidos descuentos/cargos), implementar cotización confiable desde catálogo/impuestos, exponer creación de propuesta y aplicar líneas aprobadas con stock en una misma transacción. La aprobación actual sólo registra consentimiento y no debe tratarse como cargo aplicado. A.1 sigue sin ratificar reglas económicas y consentimiento; no habilitar cargos adicionales.

## C.1

Verificar runtime de entrega/expiración y redacción de URLs en proxies externos. El envío automático es best effort cuando existe email; si falla, el personal conserva copia/reemisión.

## C.2

Ya hay panel de atenciones activas con lectura de presupuesto/propuestas, edición versionada del tope, pausa/reanudación/cierre, apertura desde reserva o walk-in, captura de email y enlace copiable/reemitible con verificación. La actualización anuncia carga, último dato y error con posible snapshot obsoleto. Falta creación de propuestas desde cotización confiable (B.4) y verificación visual/browser accesible.

## C.3

Vista pública implementada contra contratos C.1 y la ruta de decisión ahora limita solicitudes por IP; falta validar API/navegador y conexión/recarga. La decisión aprobada registra consentimiento, pero no debe considerarse cargo aplicado hasta completar la aplicación transaccional de líneas en B.4.


## Round 2 findings disposition (static review)

- F-019: composite token/delivery scope constraint added in migration `20261012160000_service_session_delivery_token_scope`; Prisma unique key added. Runtime migration application remains unverified.
- F-020: mobile station navigation link now has an explicit accessible name. Browser/assistive-technology verification remains pending.
- F-015 through F-018 remain open as described in their finding files.


## Round 2 audit summary

All thirteen perspectives were run against the implementation with varied entry points. Static follow-up fixed F-015, F-018 and F-022; F-023 was refuted by the per-service activation control and D.2 rollout procedure; F-024 was fixed with persisted email-failure alerts and stale-delivery reconciliation; F-025 was fixed with cursor pagination. F-019, F-020 and F-021 were also fixed statically. The remaining open majors are F-010 (browser accessibility evidence), F-016 (runtime compensation/concurrency evidence) and F-017 (transactional application of approved work after A.1 rules are ratified). Runtime/API/browser/migration verification remains pending in D.1.

- F-022: public and admin progress snapshots now return at most 100 newest events and expose `events_have_older`; runtime and pagination behavior remain unverified.

- F-025: active sessions now page 100 at a time using a stable ID cursor; the panel exposes “Cargar más atenciones”. Static review only.

- F-024: immediate delivery failures and stale `sending` rows now create persisted operator alerts; the bounded reconciler uses CAS. Runtime verification remains pending in D.1.

- F-017: customer and staff copy now distinguishes recorded consent from applying work to the order; application and stock handling remain open.

- F-021: the internal proposal seam now requires 1–100 object lines and validates `subtotal + tax - discount = total` with Prisma Decimal; static review only.

- F-010: replaced the false alertdialog region with shared `app-modal` configured as a real dialog, which owns focus placement/trapping/restoration and Escape behavior. Browser/reader verification remains open.

- F-015: walk-in allocation and booking-to-session transfer now use the shared coordinator inside the session transaction; schedule/provider validation is still duplicated, so the finding remains open.

- F-010: consent dialog now uses shared `app-modal` with `dialog=true`, describedBy, focus trap/restoration, and Escape handling; static API review only, browser and screen-reader verification pending.
