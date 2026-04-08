# ExpandableCard

Componente accordion-style expandable card con soporte para two-way binding del estado expandido.
Incluye slots para header, acciones y contenido colapsable.

## Uso

```html
<!-- Basico -->
<app-expandable-card [(expanded)]="isOpen">
  <div slot="header">
    <h3>Titulo de la seccion</h3>
  </div>
  <p>Contenido colapsable aqui.</p>
</app-expandable-card>

<!-- Con acciones en el header -->
<app-expandable-card [(expanded)]="isOpen">
  <div slot="header">
    <span>Mi seccion</span>
  </div>
  <div slot="actions">
    <app-toggle [(value)]="isActive" />
  </div>
  <div>Contenido del body</div>
</app-expandable-card>
```

## Inputs

| Input    | Tipo    | Default | Descripcion                              |
| -------- | ------- | ------- | ---------------------------------------- |
| expanded | boolean | false   | Estado expandido/colapsado (two-way)     |
| disabled | boolean | false   | Deshabilita la interaccion con el toggle |

## Slots (ng-content)

| Slot       | Descripcion                                      |
| ---------- | ------------------------------------------------ |
| [slot=header]  | Contenido del header (siempre visible)       |
| [slot=actions] | Acciones en el header (no activan el toggle) |
| (default)      | Contenido del body (visible cuando expanded) |

## Importante

- El slot `[slot=actions]` tiene `stopPropagation` para evitar que clicks en acciones (toggles, botones) disparen el expand/collapse.
- Usa `model()` para two-way binding: `[(expanded)]="mySignal"`.
- Respeta `prefers-reduced-motion` desactivando animaciones.
- El header usa un `<button>` nativo para accesibilidad (teclado y screen readers).
