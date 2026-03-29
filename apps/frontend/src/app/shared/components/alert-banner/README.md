# AlertBanner

Banner de alerta con variantes visuales (warning, info, danger, success) que incluye icono y texto.

## Uso

```html
<app-alert-banner variant="info"> Este es un mensaje de informacion. </app-alert-banner>

<app-alert-banner variant="warning" icon="alert-triangle"> Atencion: algo necesita revision. </app-alert-banner>

<app-alert-banner variant="success"> Operacion completada con exito. </app-alert-banner>

<app-alert-banner variant="danger"> Ha ocurrido un error critico. </app-alert-banner>
```

## Inputs

| Input   | Tipo               | Default | Descripcion                                                   |
| ------- | ------------------ | ------- | ------------------------------------------------------------- |
| variant | AlertBannerVariant | 'info'  | Variante visual: 'warning' \| 'info' \| 'danger' \| 'success' |
| icon    | string             | 'info'  | Nombre del icono de Lucide a mostrar en el banner             |

## Importante

- El contenido del banner se pasa via ng-content (slot por defecto).
- Los iconos disponibles dependen del ICON_REGISTRY en `icon/icons.registry.ts`.
- Las clases de color se aplican automaticamente segun la variante.
