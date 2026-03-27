# OptionsDropdown

Dropdown avanzado que combina filtros (selector, multi-selector) y acciones. Soporta debounce en cambios de filtro y cuenta de filtros activos.

## Uso

```typescript
import { FilterConfig, DropdownAction } from './options-dropdown.interfaces';

filters: FilterConfig[] = [
  {
    key: 'status',
    label: 'Estado',
    type: 'selector',
    options: [
      { label: 'Activo', value: 'active' },
      { label: 'Inactivo', value: 'inactive' },
    ],
  },
  {
    key: 'categories',
    label: 'Categorias',
    type: 'multi-select',
    options: [
      { label: 'Electronica', value: 'electronics' },
      { label: 'Ropa', value: 'clothing' },
    ],
  },
];

actions: DropdownAction[] = [
  { id: 'export', label: 'Exportar CSV', icon: 'download' },
  { id: 'print', label: 'Imprimir', icon: 'printer' },
];
```

```html
<app-options-dropdown [filters]="filters" [actions]="actions" [filterValues]="filterValues" triggerLabel="Filtros" triggerIcon="sliders-horizontal" [debounceMs]="350" [isLoading]="false" (filterChange)="onFilterChange($event)" (actionClick)="onAction($event)" (clearAllFilters)="onClearAll()"> </app-options-dropdown>
```

## Inputs

| Input        | Tipo             | Default              | Descripcion                           |
| ------------ | ---------------- | -------------------- | ------------------------------------- |
| filters      | FilterConfig[]   | []                   | Configuracion de cada filtro          |
| actions      | DropdownAction[] | []                   | Acciones disponibles en el dropdown   |
| filterValues | FilterValues     | {}                   | Valores actuales de los filtros       |
| title        | string           | 'Opciones'           | Titulo en el header del dropdown      |
| triggerLabel | string           | 'Opciones'           | Texto del boton trigger               |
| triggerIcon  | IconName         | 'sliders-horizontal' | Icono del boton trigger               |
| debounceMs   | number           | 350                  | Milisegundos de debounce para cambios |
| isLoading    | boolean          | false                | Estado de carga                       |

## Outputs

| Output          | Tipo         | Descripcion                               |
| --------------- | ------------ | ----------------------------------------- |
| filterChange    | EventEmitter | Emite valores de filtro (tras debounce)   |
| actionClick     | EventEmitter | Emite el `id` de la accion seleccionada   |
| clearAllFilters | EventEmitter | Emite al hacer click en "Limpiar filtros" |

## Interfaces

```typescript
// options-dropdown.interfaces.ts
interface FilterConfig {
  key: string;
  label: string;
  type: "selector" | "multi-select" | "date-range" | "search";
  options?: { label: string; value: string }[];
  // ...
}

interface DropdownAction {
  id: string;
  label: string;
  icon?: IconName;
  // ...
}

type FilterValues = Record<string, string | string[] | null>;
```

## Importante

- `clearAllFilters` solo emite; el padre es responsable de resetear `filterValues` a los valores por defecto.
- El contador de filtros activos (`activeFiltersCount`) se muestra en el trigger cuando es mayor a 0.
- `filterChange` se emite con debounce; `clearFilter` (por filtro individual) emite inmediatamente.
- El dropdown se cierra al hacer clic fuera (`document:click`) y con Escape.
- Depende de `SelectorComponent` y `MultiSelectorComponent`.
