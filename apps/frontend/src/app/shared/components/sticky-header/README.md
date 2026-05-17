# StickyHeader

Cabecera fija para paginas de modulo admin. Muestra titulo, subtitulo, icono, badge, botones de accion, opcion de volver atras y pestañas opcionales.

## Uso

```html
<app-sticky-header
  [title]="'Productos'"
  [subtitle]="'45 articulos'"
  icon="package"
  variant="glass"
  [showBackButton]="true"
  [backRoute]="'/inventory'"
  badgeText="Activo"
  badgeColor="green"
  [badgePulse]="false"
  [actions]="actionButtons"
  [tabs]="tabs"
  [activeTab]="activeTab()"
  (actionClicked)="onAction($event)"
  (tabChanged)="activeTab.set($event)"
/>
```

## Inputs

| Input           | Tipo                       | Default     | Descripcion                                                       |
| --------------- | -------------------------- | ----------- | ----------------------------------------------------------------- |
| title           | string                     | (requerido) | Titulo principal de la pagina                                     |
| subtitle        | string                     | ''          | Subtitulo o descripcion                                           |
| icon            | string                     | 'box'       | Nombre del icono de Lucide                                        |
| variant         | StickyHeaderVariant        | 'glass'     | Variante visual: 'default' \| 'glass'                             |
| showBackButton  | boolean                    | false       | Mostrar boton de volver atras                                     |
| backRoute       | string \| string[]         | '/'         | Ruta del boton de volver atras                                    |
| metadataContent | string                     | ''          | Texto auxiliar renderizado como interpolacion                     |
| badgeText       | string                     | ''          | Texto del badge                                                   |
| badgeColor      | StickyHeaderBadgeColor     | 'blue'      | Color del badge: 'green' \| 'blue' \| 'yellow' \| 'gray' \| 'red' |
| badgePulse      | boolean                    | false       | Activa animacion de pulso en el badge                             |
| actions         | StickyHeaderActionButton[] | []          | Botones de accion (ver interfaz abajo)                            |
| tabs            | StickyHeaderTab[]          | []          | Pestañas opcionales para vistas o rutas del modulo                |
| activeTab       | string                     | ''          | Id activo para tabs de estado local                               |
| tabsAriaLabel   | string                     | 'Secciones' | Etiqueta accesible para el grupo de tabs                          |

## Outputs

| Output        | Tipo         | Descripcion                        |
| ------------- | ------------ | ---------------------------------- |
| actionClicked | EventEmitter | Emite el `id` del boton presionado |
| tabChanged    | EventEmitter | Emite el `id` de la pestaña seleccionada |

## Interfaces

```typescript
interface StickyHeaderActionButton {
  id: string;
  label: string;
  variant: "primary" | "secondary" | "outline" | "outline-danger" | "ghost" | "danger";
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  visible?: boolean;
}

interface StickyHeaderTab {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: string;
  route?: string | unknown[];
  exact?: boolean;
  disabled?: boolean;
  visible?: boolean;
}

type StickyHeaderVariant = "default" | "glass";
type StickyHeaderBadgeColor = "green" | "blue" | "yellow" | "gray" | "red";
```

## Pestañas

Las pestañas se renderizan en una fila compacta en la parte superior del header.

## Estándar visual

El header mantiene el mismo tamaño de ícono y padding en todos los módulos:

- Fila principal: `p-1.5 md:px-6 md:py-2`.
- Contenedor de ícono: `w-10 h-10`.
- Ícono principal: `20px`.
- Fila de tabs: mismo padding horizontal que la fila principal.

No reduzcas estos valores para headers con tabs; las pestañas viven en su propia fila y la fila principal conserva la misma jerarquía visual que la pantalla de productos.

### Tabs por estado local

```typescript
readonly activeTab = signal('overview');

readonly tabs: StickyHeaderTab[] = [
  { id: 'overview', label: 'Resumen', icon: 'file-text' },
  { id: 'pricing', label: 'Precios', icon: 'credit-card' },
];
```

```html
<app-sticky-header
  title="Nuevo plan"
  subtitle="Crea un plan de suscripción"
  icon="credit-card"
  [tabs]="tabs"
  [activeTab]="activeTab()"
  (tabChanged)="activeTab.set($event)"
/>
```

### Tabs por ruta

```typescript
readonly tabs: StickyHeaderTab[] = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard', route: 'overview' },
  { id: 'health', label: 'Salud', icon: 'heart-pulse', route: 'health' },
];
```

```html
<app-sticky-header
  title="Monitoreo"
  subtitle="Estado del sistema"
  icon="activity"
  [tabs]="tabs"
  tabsAriaLabel="Secciones de monitoreo"
/>
```

## Importante

- `title` es un input requerido (usando `input.required<string>()`).
- El boton de volver atras usa `RouterLink` para navegacion.
- Las tabs con `route` usan `RouterLink`; las tabs sin `route` emiten `tabChanged`.
- Ver la plantilla en `sticky-header.component.html` para la estructura completa.
