# EmptyState

Pantalla de estado vacio con icono, titulo, descripcion y acciones opcionales.

## Uso

```html
<app-empty-state icon="inbox" title="No hay productos" description="Agrega tu primer producto para comenzar" [showActionButton]="true" actionButtonText="Crear Producto" (actionClick)="onCreate()"></app-empty-state>

<!-- Con boton de limpiar filtros -->
<app-empty-state icon="search" title="Sin resultados" [showClearFilters]="true" (clearFiltersClick)="onClearFilters()"></app-empty-state>
```

## Inputs

| Input               | Tipo             | Default                          | Descripcion                                     |
| ------------------- | ---------------- | -------------------------------- | ----------------------------------------------- |
| `icon`              | `string`         | `inbox`                          | Nombre del icono (Lucide)                       |
| `title`             | `string`         | `'No hay datos'`                 | Titulo principal                                |
| `description`       | `string`         | `'No se encontraron registros.'` | Descripcion                                     |
| `actionButtonText`  | `string`         | `'Crear Nuevo'`                  | Texto del boton principal                       |
| `actionButtonIcon`  | `string \| null` | `plus`                           | Icono del boton principal (null para sin icono) |
| `showActionButton`  | `boolean`        | `true`                           | Mostrar boton principal                         |
| `showRefreshButton` | `boolean`        | `false`                          | Mostrar boton de actualizar                     |
| `showClearFilters`  | `boolean`        | `false`                          | Mostrar boton de limpiar filtros                |

## Outputs

| Output              | Tipo                 | Descripcion                        |
| ------------------- | -------------------- | ---------------------------------- |
| `actionClick`       | `EventEmitter<void>` | Click en boton de accion principal |
| `refreshClick`      | `EventEmitter<void>` | Click en boton de actualizar       |
| `clearFiltersClick` | `EventEmitter<void>` | Click en boton de limpiar filtros  |

## Importante

- El icono se muestra en un contenedor circular con gradiente de fondo
- Los botones se apilan verticalmente en mobile y horizontalmente en desktop (sm+)
