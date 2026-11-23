# ListSearchBar

Barra de búsqueda modelo de los listados del admin: título opcional + buscador + menú de opciones (filtros y acciones). En móvil queda fija (sticky) debajo de lo que ya está fijo arriba, con fondo y sombra suave en los controles; desde `md` es una fila normal con borde inferior, para ir dentro de la card.

Es el mismo estilo que tenía a mano `/admin/customers/all`. Las pantallas que aún copian ese bloque se migran a este componente poco a poco.

## Uso

```html
<!-- Listado estándar (stats fijas arriba), dentro de la card -->
<app-list-search-bar
  [title]="'Todos los Clientes (' + totalItems() + ')'"
  placeholder="Buscar clientes..."
  [filters]="filterConfigs()"
  [filterValues]="filterValues()"
  [actions]="dropdownActions"
  [isLoading]="loading()"
  (searchChange)="onSearch($event)"
  (filterChange)="onFilterChange($event)"
  (clearAllFilters)="clearFilters()"
  (actionClick)="onActionClick($event)"
></app-list-search-bar>

<!-- Solo móvil, fuera de la card y debajo de un app-sticky-header sin pestañas -->
@if (isMobile()) {
  <app-list-search-bar offset="header" [desktopRow]="false" ... ></app-list-search-bar>
}
```

## Inputs

| Input                | Tipo                                    | Default       | Descripción                                                                 |
| -------------------- | --------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| `title`              | `string`                                | `''`          | Título del listado; vacío lo oculta                                         |
| `placeholder`        | `string`                                | `'Buscar...'` | Placeholder del buscador                                                    |
| `debounceTime`       | `number`                                | `300`         | Debounce del buscador (ms)                                                  |
| `offset`             | `'stats' \| 'header' \| 'header-tabs'`  | `'stats'`     | Dónde se fija en móvil: bajo stats (99px), bajo sticky-header (52px) o con pestañas (token) |
| `desktopRow`         | `boolean`                               | `true`        | Estilos de fila de escritorio (padding + borde); `false` si solo se muestra en móvil |
| `filters`            | `FilterConfig[]`                        | `[]`          | Filtros del menú de opciones                                                |
| `filterValues`       | `FilterValues`                          | `{}`          | Valores actuales de los filtros                                             |
| `actions`            | `DropdownAction[]`                      | `[]`          | Acciones del menú                                                           |
| `singleActionAsMenu` | `boolean`                               | `false`       | Igual que en `app-options-dropdown`                                         |
| `isLoading`          | `boolean`                               | `false`       | Estado de carga del menú                                                    |
| `showOptions`        | `boolean`                               | `true`        | Oculta el menú de opciones si el listado no tiene filtros ni acciones       |

## Outputs

`searchChange` (string, con debounce), `filterChange` (FilterValues), `clearAllFilters`, `actionClick` (string).
