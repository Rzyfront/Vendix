# AlertBanner

Banner de alerta con variantes visuales (warning, info, danger, success) que incluye icono y texto.

## Uso

```html
<app-alert-banner variant="info"> Este es un mensaje de informacion. </app-alert-banner>

<app-alert-banner variant="warning" icon="alert-triangle"> Atencion: algo necesita revision. </app-alert-banner>

<app-alert-banner variant="success"> Operacion completada con exito. </app-alert-banner>

<app-alert-banner variant="danger"> Ha ocurrido un error critico. </app-alert-banner>
```

## Con titulo y accion

```html
<app-alert-banner variant="warning" icon="alert-triangle" tone="token" heading="No se pudieron leer las reglas del perfil">
  La factura se puede emitir igual: el servidor la timbra con la version vigente del perfil.
  <button bannerActions type="button" (click)="retry()">Reintentar</button>
</app-alert-banner>
```

## Inputs

| Input   | Tipo               | Default     | Descripcion                                                     |
| ------- | ------------------ | ----------- | --------------------------------------------------------------- |
| variant | AlertBannerVariant | 'info'      | Variante visual: 'warning' \| 'info' \| 'danger' \| 'success'   |
| icon    | string             | 'info'      | Nombre del icono de Lucide a mostrar en el banner               |
| tone    | AlertBannerTone    | 'palette'   | 'palette' = paleta fija Tailwind (comportamiento historico); 'token' = tokens del tema |
| heading | string             | ''          | Titulo en negrita sobre el cuerpo. Vacio = banner de una linea  |

## Slots

| Slot             | Descripcion                                              |
| ---------------- | -------------------------------------------------------- |
| (por defecto)    | Cuerpo del mensaje                                       |
| `[bannerActions]`| Botones de accion bajo el cuerpo (p. ej. «Reintentar»)   |

## Importante

- El contenedor lleva `role="alert"` SIEMPRE. Un banner que explica por que algo no se puede
  hacer y no se anuncia deja sin motivo al usuario que no ve la pantalla.
- **`tone` por defecto es `'palette'` a proposito.** Los 153 usos existentes se pintan con la
  paleta fija de Tailwind; cambiarles el tono seria un repintado de 85 archivos que nadie pidio.
  **Codigo nuevo debe usar `tone="token"`**, que es lo que exige `vendix-frontend-theme`.
- El contenido del banner se pasa via ng-content (slot por defecto).
- Los iconos disponibles dependen del ICON_REGISTRY en `icon/icons.registry.ts`.
- Con `heading`, el cuerpo pasa a peso normal y `leading-relaxed`: un parrafo explicativo en
  seminegrita se lee como un grito.
