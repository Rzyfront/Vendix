# ScrollableTabs

Tabs horizontales con scroll lateral cuando el contenido excede el ancho del contenedor. Flechas de navegacion izquierda/derecha y auto-scroll a la tab activa.

## Cuándo usarlo (solo capa 4)

Jerarquía de navegación: 1 módulo (sidebar) → 2 submódulo (sidebar) → 3 subvistas de una vista (tabs de `app-sticky-header`) → **4 subvistas dentro de una tab (este componente)**.

- Úsalo solo dentro del contenido de una tab del sticky header.
- No lo uses como primera fila de tabs de una vista: eso es capa 3 y va en `app-sticky-header` (`[tabs]`). Si la vista no tiene sticky header, agrégalo.
- Nada por debajo de la capa 4.

## Uso

```typescript
tabs: ScrollableTab[] = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Activos', icon: 'check-circle' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'archived', label: 'Archivados' },
];
```

```html
<app-scrollable-tabs [tabs]="tabs" [activeTab]="currentTab" size="md" ariaLabel="Filtros de productos" (tabChange)="currentTab = $event"> </app-scrollable-tabs>
```

## Inputs

| Input     | Tipo              | Default     | Descripcion                          |
| --------- | ----------------- | ----------- | ------------------------------------ |
| tabs      | ScrollableTab[]   | (requerido) | Lista de tabs (ver interfaz)         |
| activeTab | string            | (requerido) | ID de la tab activa                  |
| size      | ScrollableTabSize | 'md'        | Tamano: 'xs' \| 'sm' \| 'md' \| 'lg' |
| ariaLabel | string            | 'Tabs'      | Etiqueta ARIA para accesibilidad     |

## Outputs

| Output    | Tipo         | Descripcion                  |
| --------- | ------------ | ---------------------------- |
| tabChange | EventEmitter | Emite el ID de la tab seleccionada |

## Interfaces

```typescript
interface ScrollableTab {
  id: string;
  label: string;
  icon?: string; // Nombre del icono de Lucide
}

type ScrollableTabSize = "xs" | "sm" | "md" | "lg";
```

## Importante

- Las flechas de scroll se muestran/ocultan automaticamente segun el overflow (via `ResizeObserver`).
- Al cambiar `activeTab`, se hace auto-scroll para traer la tab activa a la vista (`scrollIntoView`).
- El scroll lateral usa `scrollBy` con 75% del ancho visible del contenedor.
- El tamano afecta tanto a las tabs como a las flechas de navegacion.
- Ver plantilla en `scrollable-tabs.component.html` y estilos en `scrollable-tabs.component.scss`.
