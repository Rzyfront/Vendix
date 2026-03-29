# Button

Boton configurable con variantes de estilo, tamanos y estados de carga.

## Uso

```html
<app-button variant="primary" size="md" (clicked)="handleClick()"> Texto del boton </app-button>

<!-- Con icono -->
<app-button variant="outline" size="sm">
  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
  Accion
</app-button>

<!-- Loading -->
<app-button variant="primary" [loading]="true" [showTextWhileLoading]="true"> Procesando... </app-button>
```

## Inputs

| Input                  | Tipo                              | Default   | Descripcion                                                                                                              |
| ---------------------- | --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `variant`              | `ButtonVariant`                   | `primary` | Variante de estilo: `primary`, `secondary`, `outline`, `outline-danger`, `outline-warning`, `ghost`, `danger`, `success` |
| `size`                 | `ButtonSize`                      | `md`      | Tamanio: `xsm`, `sm`, `md`, `lg`                                                                                         |
| `type`                 | `'button' \| 'submit' \| 'reset'` | `button`  | Tipo de HTML del boton                                                                                                   |
| `form`                 | `string`                          | -         | ID del formulario asociado                                                                                               |
| `disabled`             | `boolean`                         | `false`   | Deshabilita el boton                                                                                                     |
| `loading`              | `boolean`                         | `false`   | Muestra spinner de carga                                                                                                 |
| `showTextWhileLoading` | `boolean`                         | `false`   | Mantiene el texto visible durante loading                                                                                |
| `fullWidth`            | `boolean`                         | `false`   | Ocupa todo el ancho disponible                                                                                           |
| `customClasses`        | `string`                          | `''`      | Clases CSS adicionales                                                                                                   |

## Outputs

| Output    | Tipo                  | Descripcion                                                            |
| --------- | --------------------- | ---------------------------------------------------------------------- |
| `clicked` | `EventEmitter<Event>` | Emite cuando se hace clic en el boton (no emite si disabled o loading) |

## Importante

- El contenido se trunca automaticamente con ellipsis si excede el ancho
- Los iconos nunca se truncan ni achican (flex-shrink-0)
- Compatible con `form` attribute para botones fuera de un `<form>`
