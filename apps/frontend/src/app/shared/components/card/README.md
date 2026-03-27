# Card

Contenedor de contenido con slots para header, body y footer, y animaciones opcionales.

## Uso

```html
<app-card title="Titulo" subtitle="Subtitulo"> Contenido del card </app-card>

<!-- Con slots personalizados -->
<app-card [showHeader]="true">
  <div slot="header">Custom Header</div>
  <p>Body content</p>
  <div slot="footer">Custom Footer</div>
</app-card>

<!-- Con animacion -->
<app-card [animateOnLoad]="true"> Contenido animado al cargar </app-card>
```

## Inputs

| Input                         | Tipo                                     | Default  | Descripcion                                                       |
| ----------------------------- | ---------------------------------------- | -------- | ----------------------------------------------------------------- |
| `title`                       | `string`                                 | -        | Titulo del header                                                 |
| `subtitle`                    | `string`                                 | -        | Subtitulo del header                                              |
| `shadow`                      | `'none' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `sm`     | Nivel de sombra                                                   |
| `padding`                     | `boolean`                                | `true`   | Agrega padding interno                                            |
| `customClasses`               | `string`                                 | `''`     | Clases CSS adicionales                                            |
| `animateOnLoad`               | `boolean`                                | `false`  | Anima entrada con slide-up-fade                                   |
| `responsivePadding`           | `boolean`                                | `false`  | Padding adaptativo: p-4 mobile / p-6 desktop                      |
| `overflow`                    | `'hidden' \| 'visible' \| 'auto'`        | `hidden` | Comportamiento de overflow                                        |
| `responsive`                  | `boolean`                                | `false`  | Aplica estilos de card solo en md+ (desktop); mobile transparente |
| `width`, `height`, `maxWidth` | `string`                                 | -        | Tamanos CSS opcionales                                            |
| `showHeader`                  | `boolean`                                | `false`  | Muestra header aunque no tenga title/subtitle (para slots custom) |

## Slots

| Slot            | Descripcion                    |
| --------------- | ------------------------------ |
| (default)       | Contenido del body             |
| `slot="header"` | Contenido adicional del header |
| `slot="footer"` | Contenido del footer           |

## Importante

- El footer solo se renderiza cuando tiene contenido en `slot="footer"`
- `responsivePadding` es util para formularios que necesitan mas espacio en desktop
- `overflow="visible"` permite que tooltips o dropdowns se muestren fuera del card
