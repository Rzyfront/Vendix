# ItemList

Vista de lista estilo card para dispositivos moviles. Es el equivalente mobile de `app-table`.

## Uso

```html
<app-item-list [data]="items" [cardConfig]="cardConfig" [actions]="rowActions" (itemClick)="onItemClick($event)" (actionClick)="onActionClick($event)"></app-item-list>
```

## Inputs

| Input          | Tipo                 | Default                      | Descripcion                   |
| -------------- | -------------------- | ---------------------------- | ----------------------------- |
| `data`         | `any[]`              | `[]`                         | Array de elementos a mostrar  |
| `cardConfig`   | `ItemListCardConfig` | -                            | Configuracion de las tarjetas |
| `actions`      | `TableAction[]`      | -                            | Acciones disponibles por item |
| `loading`      | `boolean`            | `false`                      | Estado de carga               |
| `emptyMessage` | `string`             | `'No hay datos disponibles'` | Mensaje de estado vacio       |
| `emptyIcon`    | `string`             | `inbox`                      | Icono del estado vacio        |
| `size`         | `ItemListSize`       | `md`                         | Tamanio: `sm`, `md`, `lg`     |

## Outputs

| Output        | Tipo                             | Descripcion                          |
| ------------- | -------------------------------- | ------------------------------------ |
| `itemClick`   | `EventEmitter<any>`              | Emite cuando se hace clic en un item |
| `actionClick` | `EventEmitter<{ action, item }>` | Emite cuando se ejecuta una accion   |

## ItemListCardConfig

```typescript
interface ItemListCardConfig {
  titleKey: string; // Ruta al titulo (soporta dot notation)
  titleTransform?: (item: any) => string;
  subtitleKey?: string; // Ruta al subtitulo
  subtitleTransform?: (item: any) => string;
  avatarKey?: string; // URL de avatar
  avatarFallbackIcon?: string; // Icono cuando no hay avatar
  badgeKey?: string; // Ruta al valor del badge
  badgeTransform?: (value: any) => string;
  badgeConfig?: BadgeConfig;
  footerKey?: string; // Ruta al valor del footer
  footerTransform?: (value: any, item: any) => string;
}
```

## Action Variants

Los botones de accion en las cards usan un estilo circular pastel con colores basados en tokens CSS del tema. Soportan variant estatico o dinamico (funcion).

| Variant     | Token CSS               | Color     |
| ----------- | ----------------------- | --------- |
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

### Variant dinamico

`variant` acepta `((item: any) => string)` para cambiar el color segun el estado del item:

```typescript
actions: TableAction[] = [
  {
    label: (item) => (item.is_active ? 'Desactivar' : 'Activar'),
    icon: (item) => (item.is_active ? 'toggle-right' : 'toggle-left'),
    variant: (item) => (item.is_active ? 'success' : 'secondary'),
    action: (item) => this.toggle(item),
  },
];
```

> `label`, `icon` y `variant` soportan funciones dinamicas. Se resuelven por item.
> Las primeras 2 acciones se muestran como botones circulares. El resto va al dropdown menu (icono `more-horizontal`).

## Importante

- Diseñado especificamente para mobile-first (responsivo inverso de `app-table`)
- Soporta valores anidados con dot notation (`user.address.city`)
- Los badges soportan configuracion de `type: 'status'` y `type: 'custom'`
