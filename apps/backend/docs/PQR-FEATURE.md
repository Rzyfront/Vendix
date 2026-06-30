# PQR Feature (Peticiones, Quejas, Reclamos)

Canal público/privado de PQRs. Cualquier visitante puede radicar una PQR a
través del storefront; el ticket se almacena en la org Vendix y se notifica
automáticamente a `admin@vendix.online`. Los `store_admin` gestionan los PQRs
en un nuevo panel `/admin/pqrs`.

## Rutas

### Públicas (`@Public()`)
- `POST /api/pqr` — crear PQR (rate-limited 20 req/min/IP)
- `GET /api/pqr/:ticket_number` — tracking público

### Admin (requieren JWT store_admin + permisos `store:support:pqr:*`)
- `GET    /api/store/support/pqr`           — lista paginada
- `GET    /api/store/support/pqr/stats`     — métricas
- `GET    /api/store/support/pqr/:id`        — detalle
- `PATCH  /api/store/support/pqr/:id`        — actualizar prioridad/asignado/tags
- `PATCH  /api/store/support/pqr/:id/status` — cambiar estado (dispara email al solicitante si pasa a RESOLVED/CLOSED)
- `PATCH  /api/store/support/pqr/:id/assign` — asignar a un usuario
- `POST   /api/store/support/pqr/:id/comments` — agregar comentario (interno o público)

## Modelo de datos

Reutiliza `support_tickets` con la nueva `category` ∈ `{PETITION, COMPLAINT, CLAIM}`.
Reutiliza `support_comments` con `is_internal` (true = nota admin, false = respuesta
pública al solicitante que dispara email).
PQRs se filtran con `tags: { has: 'pqr' }` para diferenciarlos de tickets de soporte
regulares del módulo existente.

## Decisiones arquitectónicas

- **Path admin `/store/support/pqr`** (no `/pqr/admin/*`) — el `DomainScopeGuard`
  global exige `/store/*` para `STORE_ADMIN`. Un path fuera de `/store/*` sería
  bloqueado.
- **`GlobalPrismaService` en vez de `OrganizationPrismaService`** — los PQRs
  son plataforma-wide (atributo de la org Vendix `is_platform: true`), no de
  una tienda individual. Por eso no necesitan scoping por organización.
- **Email del solicitante parseado del `description`** — pragmático para MVP.
  TODO post-MVP: añadir columnas dedicadas `requester_email`, `requester_name`,
  `requester_phone` y backfill desde el description.

## Flujo de notificaciones

```
Visitor → POST /api/pqr
   ↓
PqrService.createPublic()
   ↓ insert + emit('pqr.created')
PqrEmailService.handlePqrCreated()
   ↓
   ├─→ admin@vendix.online  (notificación de PQR nuevo)
   └─→ requester email      (acknowledgement)

Admin → PATCH /api/store/support/pqr/:id/status  (status: RESOLVED | CLOSED)
   ↓
PqrService.adminUpdateStatus()
   ↓ update + status_history + emit('pqr.status_changed')
PqrEmailService.handlePqrStatusChanged()
   ↓
   └─→ requester email  (notificación de cierre)

Admin → POST /api/store/support/pqr/:id/comments  (is_internal: false)
   ↓
PqrService.adminAddComment()
   ↓ insert + emit('pqr.response_sent')
PqrEmailService.handlePqrResponseSent()
   ↓
   └─→ requester email  (respuesta del equipo)
```

## Permisos añadidos (seed)

```
store:support:pqr:read      GET    /api/store/support/pqr
store:support:pqr:read      GET    /api/store/support/pqr/stats
store:support:pqr:read      GET    /api/store/support/pqr/:id
store:support:pqr:update    PATCH  /api/store/support/pqr/:id
store:support:pqr:status    PATCH  /api/store/support/pqr/:id/status
store:support:pqr:assign    PATCH  /api/store/support/pqr/:id/assign
store:support:pqr:comment   POST   /api/store/support/pqr/:id/comments
```

Asignados automáticamente al rol `owner` y `admin` (filtran por `store:*`).
Si necesitas asignar a un rol custom, edita el `syncRolePermissions` del seed.

## Migración Prisma

```
20260624201432_add_pqr_ticket_categories
```

**⚠️ LECCION OPERATIVA IMPORTANTE**: durante el setup inicial, ejecutamos
`npx prisma migrate resolve --applied` sobre esta migración ANTES de que
los `ALTER TYPE` corrieran contra la DB. El comando `resolve --applied`
solo actualiza el historial de migraciones; **NO ejecuta el SQL real**.

Síntoma: el backend devolvía `P2007 invalid input value for enum
ticket_category_enum: "COMPLAINT"` incluso después de regenerar el
Prisma Client y reiniciar el proceso.

Fix manual (lo que tuvimos que hacer en esta primera instalación):

```bash
cd apps/backend
npx prisma db execute --file - <<'EOF'
ALTER TYPE "ticket_category_enum" ADD VALUE IF NOT EXISTS 'PETITION';
ALTER TYPE "ticket_category_enum" ADD VALUE IF NOT EXISTS 'COMPLAINT';
ALTER TYPE "ticket_category_enum" ADD VALUE IF NOT EXISTS 'CLAIM';
EOF
```

**Para futuras migraciones**: en CI, `prisma migrate deploy` aplica el SQL
automáticamente. En dev, **ejecutar el SQL ANTES de `resolve --applied`**,
o simplemente usar `prisma migrate dev` que aplica el SQL + actualiza el
historial en un solo paso.

## Smoke test manual

```bash
# 1. Crear PQR público
curl -X POST http://localhost:3000/api/pqr \
  -H "Content-Type: application/json" \
  -d '{"pqr_type":"COMPLAINT","name":"Test","email":"test@example.com","subject":"Prueba","description":"Esta descripción supera los veinte caracteres mínimos."}'

# 2. Verificar tracking
curl http://localhost:3000/api/pqr/PQR-1-00001

# 3. Verificar email en MailHog (http://localhost:8025)
#    → debe haber email a admin@vendix.online Y a test@example.com
```

## Estado actual

✅ Implementado y validado end-to-end:
- POST /api/pqr con pqr_type: PETITION/COMPLAINT/CLAIM acepta y crea ticket
- GET /api/pqr/:ticket_number retorna vista sanitizada
- Email a admin@vendix.online enviado correctamente (SES verificado)
- Email al solicitante enviado correctamente
- Endpoints admin registrados con @Permissions (401 sin auth = correcto)

⏳ Pendiente (no bloqueante):
- Tests unitarios del servicio y controller
- Code review con `pr-code-review` skill
- Captcha / rate limit más estricto por IP
- Columnas dedicadas para requester (en lugar de parsear del description)
