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

<!-- Accion de IA (Vendix AI Style) -->
<app-button variant="ai" (clicked)="scan()">
  <app-icon name="sparkles" [size]="16" slot="icon"></app-icon>
  Escanear con IA
</app-button>
```

## Variantes

| Variante            | Reposo                                    | Hover (no deshabilitado)                                  |
| ------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `primary`           | Relleno primario + glow                   | `brightness-110`                                          |
| `secondary`         | Relleno secundario + glow                 | `brightness-110`                                          |
| `danger`            | Relleno destructivo + glow                | `brightness-110`                                          |
| `success`           | Relleno exito + glow                      | `brightness-110`                                          |
| `ghost`             | Sin fondo, texto primario                 | Fondo `--color-background`                                |
| `outline`           | Borde primario 50 % + texto primario      | **Relleno** primario, texto `--color-text-on-primary`     |
| `outline-secondary` | Borde secundario 50 % + texto secundario  | **Relleno** secundario, texto `--color-text-on-primary`   |
| `outline-danger`    | Borde destructivo 50 % + texto destructivo| **Relleno** destructivo, texto `--color-text-on-primary`  |
| `outline-warning`   | Borde warning 50 % + texto warning        | **Relleno** warning, texto oscuro (`--color-text-on-warning`, fallback `#1c1917`) |
| `outline-success`   | Borde exito 50 % + texto exito            | **Relleno** exito, texto `--color-text-on-primary`        |
| `ai`                | Gradiente IA + glow (`vx-ai-button`)      | Gradiente se desplaza, glow crece, shimmer (quieto con `prefers-reduced-motion`) |

### Outline "hover filled"

Todas las variantes outline comparten la clase `btn-outline-fill`: el borde, el
fondo y el texto pasan al color de la variante en hover; el icono proyectado
hereda `currentColor` y cambia con el texto. Disabled no se rellena. Cada
variante solo declara su terna de tokens (`--btn-outline-rgb`,
`--btn-outline-fill`, `--btn-outline-on`).

- Un `bg-*` en `customClasses` se respeta en reposo; en hover gana el relleno.
- Para conservar un look propio en hover hay que pasar utilidades con `!`
  (p. ej. `!text-error hover:!bg-error/5`): `!important` gana a la regla.
- Si el contenido proyectado trae su propio color (`<span class="text-orange-600">`)
  no cambiara en hover: usa el color heredado.

### Variante `ai`

Usa la clase global `vx-ai-button` de `src/styles/vendix-ai-style.scss`. Ver la
skill `vendix-ai-style` para tokens (`--vx-ai-*`) y el resto de clases
(`vx-ai-badge`, `vx-ai-text`, `vx-ai-surface`, ...).

## Inputs

| Input                  | Tipo                              | Default   | Descripcion                                                                                                              |
| ---------------------- | --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `variant`              | `ButtonVariant`                   | `primary` | Variante de estilo (ver tabla Variantes), incluye `ai` |
| `size`                 | `ButtonSize`                      | `md`      | Tamanio: `xsm`, `sm`, `md`, `lg`                                                                                         |
| `type`                 | `'button' \| 'submit' \| 'reset'` | `button`  | Tipo de HTML del boton                                                                                                   |
| `form`                 | `string`                          | -         | ID del formulario asociado                                                                                               |
| `disabled`             | `boolean`                         | `false`   | Deshabilita el boton                                                                                                     |
| `loading`              | `boolean`                         | `false`   | Muestra spinner de carga                                                                                                 |
| `showTextWhileLoading` | `boolean`                         | `false`   | Mantiene el texto visible durante loading                                                                                |
| `fullWidth`            | `boolean`                         | `false`   | Ocupa todo el ancho disponible                                                                                           |
| `customClasses`        | `string`                          | `''`      | Clases CSS adicionales                                                                                                   |
| `ariaLabel`            | `string`                          | `''`      | Nombre accesible para botones cuyo texto no es visible                                                                   |
| `ariaPressed`          | `boolean \| null`                 | -         | Estado de botón toggle; se refleja en el `<button>` interno                                                              |

## Outputs

| Output    | Tipo                  | Descripcion                                                            |
| --------- | --------------------- | ---------------------------------------------------------------------- |
| `clicked` | `EventEmitter<Event>` | Emite cuando se hace clic en el boton (no emite si disabled o loading) |

## Importante

- El contenido se trunca automaticamente con ellipsis si excede el ancho
- Los iconos nunca se truncan ni achican (flex-shrink-0)
- Compatible con `form` attribute para botones fuera de un `<form>`
