---
id: A.2
title: "mapear contratos y permisos"
phase: A
status: in-progress
owner: Rafael Eduardo Martinez Frontado
updated: 2026-09-10
contracts: [FB-01, FB-02, FB-03]
adrs: [ADR-01, ADR-02]
skills: [vendix-permissions, vendix-multi-tenant-context, vendix-error-handling, how-to-dev]
---
# A.2 — mapear contratos y permisos

- **Skills:** vendix-permissions, vendix-multi-tenant-context, vendix-error-handling, how-to-dev
- **Resources:** orders.controller.ts:256 stream, notifications-sse.service.ts, OrderQueryDto, store-orders.service.ts
- **Business decision:** El stream exige store:orders:read y contexto de tienda; el GET de hidratacion reutiliza el mismo permiso.
- **Why:** Un hueco de permiso o de tenant pinta ventas ajenas, el unico fallo imperdonable de este plan.
- **Output:** Registros fb/db/err completos y verificables + matriz permiso x endpoint en evidence/a2-matrix.log.
- **Contracts touched:** FB-01, FB-02, FB-03
- **Data impact:** none — sin escritura; el GET de hidratacion es lectura scodeada por store_id.
- **Blast radius:** Permisos: un gate mal copiado abre ventas a rol sin lectura; se detecta con curl 403.
- **Rollback:** Revert del bundle; ningun codigo productivo cambia en esta fase.
- **Verification:**
  - curl -s -o /dev/null -w "%{http_code}" "$API/store/orders/stream?token=BAD" | grep -q 401
  - curl -s "$API/store/orders?page=1&limit=1" -H "Authorization: Bearer $JWT" | jq .data.pagination.total
- **Acceptance checklist:**
  - [ ] Stream sin token da 401 y sin permiso 403: curl bloqueado, dev apagado
  - [ ] GET /:id otra tienda da 404/403: curl bloqueado, dev apagado
  - [x] Registros fb/db/err completos con Verification runnable → registry/
  - [x] ?token= raw en req.query; sin JWT en logs ni evidencia → a2-matrix.log
- **Status:** in-progress · Rafael Eduardo Martinez Frontado · 2026-09-10 · codigo verificado por lectura; falta curl con dev arriba
