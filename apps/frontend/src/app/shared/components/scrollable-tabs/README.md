# ScrollableTabs

Tabs horizontales con scroll lateral cuando el contenido excede el ancho del contenedor. Flechas de navegacion izquierda/derecha y auto-scroll a la tab activa.

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
| tabChange | EventEmitter | Emite el ID de la tab点击ada |

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
