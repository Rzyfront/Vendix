---
id: B.2
title: "Selector de perfil en frontend"
phase: B
status: done
owner: parallel-7
updated: 2026-09-06
contracts: [FB-03, FB-05]
adrs: []
skills: [vendix-frontend, vendix-zoneless-signals, vendix-angular-forms]
---
# B.2 — Selector de perfil en frontend

- **Skills:** vendix-frontend, vendix-zoneless-signals, vendix-angular-forms
- **Resources:** apps/frontend/src/app/private/modules/store/quotations/components/quotation-form-modal/, services/quotations.service.ts
- **Business decision:** El perfil es opcional al cotizar; vacio significa cotizar desde cero.
- **Why:** Forzar perfil frenaria a quien cotiza esporadico; el valor esta en precargar, no en obligar.
- **Output:** Selector de perfil (solo activos) + campo destino fijo al crear en el modal de cotizacion.
- **Contracts touched:** FB-03, FB-05
- **Data impact:** none — solo lectura de catalogo y envio de `profile_id?` + `destination`.
- **Blast radius:** Modal de cotizacion. Si el catalogo falla, el formulario debe seguir operando sin perfil.
- **Rollback:** Ocultar selector por flag; el backend ya acepta ausencia de perfil.
- **Verification:**
  - Crear cotizacion con y sin perfil contra API viva y comparar payloads
  - Catalogo caido no bloquea el formulario (degradacion verificada)
- **Acceptance checklist:**
  - [x] Sin perfil el formulario funciona igual que hoy (`profile_id` se omite; DTO verificado + buildcheck PASS)
  - [x] Destino se elige al crear y luego se muestra bloqueado (select en crear, deshabilitado + etiqueta "fijo" en editar; nunca viaja en edicion)
  - [ ] Con perfil precarga A/I/U, objeto y condiciones contra API viva (fallback desde cero ya verificado)
  - [ ] F-003 — Precarga A/I/U contra catalogo viva pendiente (major)
- **Status:** done (degradado por B.1 pendiente; evidencia en evidence/B.2-profile-selector-evidence.md)
