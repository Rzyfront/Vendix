# Table

Tabla de datos con columnas configurables, ordenamiento, acciones y responsividad mobile-first.

## Uso

```html
<app-table [data]="products" [columns]="columns" [actions]="rowActions" [sortable]="true" (sort)="onSort($event)" (rowClick)="onRowClick($event)"></app-table>
```

## Inputs

| Input           | Tipo            | Default                      | Descripcion               |
| --------------- | --------------- | ---------------------------- | ------------------------- |
| `data`          | `any[]`         | `[]`                         | Array de elementos        |
| `columns`       | `TableColumn[]` | `[]`                         | Definicion de columnas    |
| `actions`       | `TableAction[]` | -                            | Acciones por fila         |
| `size`          | `TableSize`     | `md`                         | Tamanio: `sm`, `md`, `lg` |
| `loading`       | `boolean`       | `false`                      | Estado de carga           |
| `emptyMessage`  | `string`        | `'No hay datos disponibles'` | Mensaje vacio             |
| `showHeader`    | `boolean`       | `true`                       | Mostrar header            |
| `striped`       | `boolean`       | `false`                      | Filas alternadas          |
| `hoverable`     | `boolean`       | `true`                       | Hover en filas            |
| `bordered`      | `boolean`       | `false`                      | Bordes en tabla           |
| `compact`       | `boolean`       | `false`                      | Modo compacto             |
| `sortable`      | `boolean`       | `false`                      | Habilitar ordenamiento    |
| `customClasses` | `string`        | `''`                         | Clases CSS adicionales    |

## Outputs

| Output     | Tipo                                  | Descripcion             |
| ---------- | ------------------------------------- | ----------------------- |
| `sort`     | `EventEmitter<{ column, direction }>` | Ordenamiento de columna |
| `rowClick` | `EventEmitter<any>`                   | Click en fila           |

## TableColumn

```typescript
interface TableColumn {
  key: string; // Clave para acceder al valor
  label: string; // Texto del header
  sortable?: boolean; // Columna ordenable
  width?: string; // Ancho CSS (ej: '120px')
  align?: "left" | "center" | "right"; // Alineacion
  template?: TemplateRef<any>; // Template personalizado
  transform?: (value: any, item?: any) => string; // Transformar valor
  cellClass?: (value: any, item?: any) => string; // Clases dinamicas
  cellStyle?: (value: any, item?: any) => Record<string, string>; // Estilos dinamicos
  defaultValue?: string; // Valor por defecto
  badge?: boolean; // Renderizar como badge
  badgeConfig?: BadgeConfig; // Configuracion del badge
  priority?: number; // Prioridad responsiva (0=siempre visible)
  type?: "text" | "image"; // Tipo de contenido
}
```

## TableAction

```typescript
interface TableAction {
  label: string | ((item: any) => string);
  icon?: string | ((item: any) => string);
  action: (item: any) => void;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success" | "warning" | "info" | "gaming" | "royal" | "muted" | ((item: any) => string);
  disabled?: (item: any) => boolean;
  show?: (item: any) => boolean;
}
```

### Action Variants

Los botones de accion usan un estilo glassmorphism pastel con gradientes suaves basados en variables CSS del tema. Si el tema cambia, los colores se adaptan automaticamente.

| Variant     | Color base                | Estilo                                        |
| ----------- | ------------------------- | --------------------------------------------- |
| `ghost`     | `--color-text-secondary`  | Sin fondo, solo texto. Default si se omite     |
| `primary`   | `--color-primary`         | Gradiente pastel del color primario del tema   |
| `secondary` | `--color-text-primary`    | Fondo neutro gris sutil                        |
| `success`   | `--color-success`         | Gradiente pastel verde                         |
| `danger`    | `--color-error`           | Gradiente pastel rojo                          |
| `warning`   | `--color-warning`         | Gradiente pastel naranja                       |
| `info`      | `--color-info`            | Gradiente pastel azul                          |
| `gaming`    | `--color-gaming`          | Gradiente pastel violeta                       |
| `royal`     | `--color-royal`           | Gradiente pastel dorado/ambar                  |
| `muted`     | `--color-muted`           | Gradiente pastel gris neutro                   |

### Variant dinamico

`variant` acepta una funcion `(item) => string` para cambiar el estilo segun el estado del item:

```typescript
providerActions: TableAction[] = [
  {
    label: "Configurar",
    icon: "settings",
    variant: "secondary",
    action: (item) => this.selectProvider(item),
  },
  {
    label: (item) => (item.is_active ? "Desactivar" : "Activar"),
    icon: (item) => (item.is_active ? "toggle-right" : "toggle-left"),
    variant: (item) => (item.is_active ? "success" : "secondary"),
    action: (item) => this.toggleActive(item),
  },
];
```

> `label`, `icon` y `variant` soportan funciones dinamicas. Se resuelven por fila.

## Importante

- Oculta automaticamente columnas en mobile segun prioridad (default: primeras 3 visibles)
- Para badges de estado, usa `badgeConfig.type = 'status'` y el componente mapa automaticamente valores comunes
- Para badges custom con colores hex, usa `badgeConfig.type = 'custom'` con `colorMap`
- Soporta valores anidados con dot notation (`user.address.city`) via `getNestedValue`
- El `emptyMessage` se muestra cuando `data` esta vacio (no depende de un componente externo)
