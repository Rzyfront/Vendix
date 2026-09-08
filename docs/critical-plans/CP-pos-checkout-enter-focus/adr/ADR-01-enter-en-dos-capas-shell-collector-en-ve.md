---
id: ADR-01
title: "Enter en dos capas (shell + collector) en vez de listener global"
status: accepted
reversibility: trivial
updated: 2026-09-08
---
# ADR-01 — Enter en dos capas (shell + collector) en vez de listener global

- **Context:** El Enter del cobro vive hoy solo en el `@HostListener('keydown')` del shell y depende del burbujeo desde los inputs del collector; el modal proyecta in-place así que el burbujeo llega, pero cualquier `stopPropagation` futuro o portal lo rompería en silencio.
- **Decision:** Dos capas: el shell sigue gobernando el avance entre pasos y el CTA terminal; el collector maneja su propio `(keydown.enter)` en sus inputs (caja, referencia, propina, override) con `stopPropagation`, replicando la semántica del driver del shell para su sub-wizard.
- **Consequences:** Enter en inputs del cobro funciona aunque el burbujeo se interrumpa; riesgo de doble manejo eliminado por el stopPropagation; el shell sigue siendo la única vía para submits (vía `confirmAmount`/`triggerSubmit`).
- **Reversibility:** trivial — quitar los bindings del template del collector devuelve el comportamiento anterior.
- **Revisit if:** El collector se usa en otro flujo con layout stepped donde Enter deba significar otra cosa.
