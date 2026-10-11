---
id: ADR-02
title: "usar tamano del trigger existente"
status: proposed
reversibility: trivial
updated: 2026-10-06
---
# ADR-02 — usar tamano del trigger existente

- **Context:** Los triggers de `app-options-dropdown` miden 40 px bajo 640 px y 44 px desde 640 px; `app-button size="md"` mide 32/44 px. «Por enviar» solo muestra icono bajo 768 px.
- **Decision:** Usar `customClasses` en este botón para fijar alto, ancho y padding a 40 × 40 y 44 × 44 px antes de `md`, conservando el tamaño de texto/escritorio desde 768 px. Pasar `ariaLabel` al botón real y agregar una entrada opcional `ariaPressed` en `ButtonComponent` para su estado.
- **Consequences:** El ajuste es local y no cambia métricas globales; `customClasses` concatena clases, así que los overrides deben tener precedencia explícita y restaurar el valor desktop desde `md:`. Se quita la sombra `btn-shadow-primary` solo a este botón para que el color percibido corresponda al `--color-primary` del tema de tienda. Verificar 320, 639/640 y 767/768 px y el tono en DOM real. Otros botones siguen usando defaults.
- **Reversibility:** trivial — revertir las clases locales y la entrada de ARIA restaura el estado previo.
- **Revisit if:** El sistema de diseño ofrece una variante icon-only de 40/44 px común al dropdown y al botón.
