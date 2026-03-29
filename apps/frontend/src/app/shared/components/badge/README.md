# Badge

Etiqueta pequena para estados, categorias o contadores.

## Uso

```html
<app-badge variant="success">Activo</app-badge>
<app-badge variant="error" size="md">Inactivo</app-badge>
<app-badge variant="warning">Pendiente</app-badge>
<app-badge variant="neutral">Borrador</app-badge>
<app-badge variant="primary">Nuevo</app-badge>
```

## Inputs

| Input     | Tipo           | Default   | Descripcion                                                   |
| --------- | -------------- | --------- | ------------------------------------------------------------- |
| `variant` | `BadgeVariant` | `neutral` | Variante: `success`, `neutral`, `error`, `primary`, `warning` |
| `size`    | `BadgeSize`    | `sm`      | Tamanio: `xsm`, `sm`, `md`                                    |

## Importante

- Es un componente de solo presentacion (no tiene outputs)
- El contenido se pasa como ng-content
