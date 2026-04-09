# ResponsiveDataView

Wrapper responsivo que muestra `app-table` en desktop (>=768px) y `app-item-list` en mobile (<768px).

## Uso

```html
<app-responsive-data-view [data]="items" [columns]="columns" [cardConfig]="cardConfig" [actions]="actions" [loading]="loading" emptyMessage="No hay productos" (sort)="onSort($event)" (rowClick)="onRowClick($event)"></app-responsive-data-view>
```

## Inputs

### Data

| Input  | Tipo    | Default | Descripcion        |
| ------ | ------- | ------- | ------------------ |
| `data` | `any[]` | `[]`    | Array de elementos |

### Table

| Input        | Tipo            | Default | Descripcion               |
| ------------ | --------------- | ------- | ------------------------- |
| `columns`    | `TableColumn[]` | `[]`    | Columnas de la tabla      |
| `tableSize`  | `TableSize`     | `md`    | Tamanio: `sm`, `md`, `lg` |
| `showHeader` | `boolean`       | `true`  | Mostrar header de tabla   |
| `striped`    | `boolean`       | `false` | Filas alternadas          |
| `hoverable`  | `boolean`       | `true`  | Hover en filas            |
| `bordered`   | `boolean`       | `false` | Bordes en tabla           |
| `compact`    | `boolean`       | `false` | Modo compacto             |
| `sortable`   | `boolean`       | `false` | Habilitar ordenamiento    |

### Item List

| Input          | Tipo                 | Default | Descripcion               |
| -------------- | -------------------- | ------- | ------------------------- |
| `cardConfig`   | `ItemListCardConfig` | -       | Configuracion de tarjetas |
| `itemListSize` | `ItemListSize`       | `md`    | Tamanio de items          |
| `emptyIcon`    | `string`             | `inbox` | Icono vacio               |

### Shared

| Input          | Tipo            | Default                      | Descripcion       |
| -------------- | --------------- | ---------------------------- | ----------------- |
| `actions`      | `TableAction[]` | -                            | Acciones por fila |
| `loading`      | `boolean`       | `false`                      | Estado de carga   |
| `emptyMessage` | `string`        | `'No hay datos disponibles'` | Mensaje vacio     |

### Empty State

| Input                   | Tipo      | Default | Descripcion                   |
| ----------------------- | --------- | ------- | ----------------------------- |
| `emptyTitle`            | `string`  | -       | Titulo del estado vacio       |
| `emptyDescription`      | `string`  | -       | Descripcion del estado vacio  |
| `emptyActionText`       | `string`  | -       | Texto del boton de accion     |
| `emptyActionIcon`       | `string`  | -       | Icono del boton de accion     |
| `showEmptyAction`       | `boolean` | `false` | Mostrar boton de accion       |
| `showEmptyClearFilters` | `boolean` | `false` | Mostrar boton limpiar filtros |
| `showEmptyRefresh`      | `boolean` | `false` | Mostrar boton actualizar      |

## Outputs

| Output                   | Tipo                                  | Descripcion                     |
| ------------------------ | ------------------------------------- | ------------------------------- |
| `sort`                   | `EventEmitter<{ column, direction }>` | Ordenamiento de columna         |
| `rowClick`               | `EventEmitter<any>`                   | Click en fila/item              |
| `actionClick`            | `EventEmitter<{ action, item }>`      | Click en accion                 |
| `emptyActionClick`       | `EventEmitter<void>`                  | Click en accion de estado vacio |
| `emptyClearFiltersClick` | `EventEmitter<void>`                  | Click en limpiar filtros        |
| `emptyRefreshClick`      | `EventEmitter<void>`                  | Click en actualizar             |

## Action Variants

Las acciones (`TableAction[]`) se renderizan en tabla (desktop) y cards (mobile) con estilos glassmorphism pastel. Todos los variants usan tokens CSS del tema.

| Variant     | Token CSS               | Color          |
| ----------- | ----------------------- | -------------- |
| `ghost`     | `--color-text-secondary`| Gris (default) |
| `primary`   | `--color-primary`       | Color del tema  |
| `secondary` | `--color-text-primary`  | Neutro          |
| `success`   | `--color-success`       | Verde           |
| `danger`    | `--color-error`         | Rojo            |
| `warning`   | `--color-warning`       | Naranja         |
| `info`      | `--color-info`          | Azul            |
| `gaming`    | `--color-gaming`        | Violeta         |
| `royal`     | `--color-royal`         | Dorado/ambar    |
| `muted`     | `--color-muted`         | Gris sutil      |

`variant` acepta un string estatico o una funcion `(item) => string` para color dinamico por fila:

```typescript
actions: TableAction[] = [
  { label: 'Ver', icon: 'eye', variant: 'info', action: (item) => this.view(item) },
  { label: 'Eliminar', icon: 'trash', variant: 'danger', action: (item) => this.delete(item) },
  {
    label: (item) => (item.is_active ? 'Desactivar' : 'Activar'),
    variant: (item) => (item.is_active ? 'success' : 'muted'),
    action: (item) => this.toggle(item),
  },
];
```

> En desktop: botones rectangulares con gradiente pastel. En mobile: botones circulares con color solido pastel.

## Importante

- Re-exporta `TableColumn`, `TableAction`, `TableSize`, `SortDirection`, `ItemListCardConfig`, `ItemListSize`
- Empty state se comparte entre desktop y mobile
- Requiere que `cardConfig` este correctamente configurado para la vista mobile
