# StickyHeader

Cabecera fija para paginas de modulo admin. Muestra titulo, subtitulo, icono, badge, botones de accion y opcion de volver atras.

## Uso

```html
<app-sticky-header [title]="'Productos'" [subtitle]="'45 articulos'" icon="package" variant="glass" [showBackButton]="true" [backRoute]="'/inventory'" badgeText="Activo" badgeColor="green" [badgePulse]="false" [actions]="actionButtons" (actionClicked)="onAction($event)"> </app-sticky-header>
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
| metadataContent | string                     | ''          | Contenido HTML arbitrario (inyectado via [innerHTML])             |
| badgeText       | string                     | ''          | Texto del badge                                                   |
| badgeColor      | StickyHeaderBadgeColor     | 'blue'      | Color del badge: 'green' \| 'blue' \| 'yellow' \| 'gray' \| 'red' |
| badgePulse      | boolean                    | false       | Activa animacion de pulso en el badge                             |
| actions         | StickyHeaderActionButton[] | []          | Botones de accion (ver interfaz abajo)                            |

## Outputs

| Output        | Tipo         | Descripcion                        |
| ------------- | ------------ | ---------------------------------- |
| actionClicked | EventEmitter | Emite el `id` del boton presionado |

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

type StickyHeaderVariant = "default" | "glass";
type StickyHeaderBadgeColor = "green" | "blue" | "yellow" | "gray" | "red";
```

## Importante

- `title` es un input requerido (usando `input.required<string>()`).
- El boton de volver atras usa `RouterLink` para navegacion.
- El contenido del slot se puede pasar para contenido libre en el header.
- Ver la plantilla en `sticky-header.component.html` para la estructura completa.
