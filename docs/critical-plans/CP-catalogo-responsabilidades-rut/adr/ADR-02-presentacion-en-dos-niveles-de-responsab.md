---
id: ADR-02
title: "Presentacion en Dos Niveles de Responsabilidades en UI"
status: proposed
reversibility: trivial
updated: 2026-09-09
---
# ADR-02 — Presentacion en Dos Niveles de Responsabilidades en UI

- **Context:** Renderizar más de 40 responsabilidades del RUT como tarjetas verticales individuales con descripciones y tooltips extensos generaría un formulario inmanejable de varios metros de scroll, provocando fricción y abandono durante el wizard de activación fiscal.
- **Decision:** Segmentar la interfaz de responsabilidades en LegalDataFormComponent en dos niveles: Nivel 1 (Responsabilidades Frecuentes) mediante toggles directos para las 8 opciones principales (05 Ordinario, 47 Simple, 48 IVA, 49 No IVA, 13 Gran Contribuyente, 15 Autorretenedor, 23 ReteIVA, 52 Facturador); y Nivel 2 (Otras responsabilidades) mediante un buscador/selector con chips removibles para agregar cualquier otra obligación del catálogo ampliado.
- **Consequences:** El formulario se mantiene limpio, comprensible y rápido para el 90% de los comercios comunes, mientras ofrece soporte del 100% de los códigos para personas jurídicas complejas y grandes contribuyentes.
- **Reversibility:** trivial — reside únicamente en la capa de presentación de LegalDataFormComponent.
- **Revisit if:** Pruebas de usabilidad demuestren que los contadores prefieren un acordeón por categorías tributarias.
