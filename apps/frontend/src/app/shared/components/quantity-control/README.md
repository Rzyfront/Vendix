# quantity-control

Control de cantidad reutilizable con botones +/- y campo de entrada editable. Usado en POS y carrito de compras.

## Uso

```html
<!-- Basico -->
<app-quantity-control [(value)]="quantity"></app-quantity-control>

<!-- Con limites -->
<app-quantity-control [(value)]="quantity" [min]="1" [max]="100" [step]="5" [size]="'md'" (valueChange)="onQuantityChange($event)"></app-quantity-control>

<!-- Solo lectura -->
<app-quantity-control [value]="3" [editable]="false"></app-quantity-control>

<!-- Deshabilitado -->
<app-quantity-control [value]="1" [disabled]="true" [loading]="true"></app-quantity-control>
```

## Inputs

| Input          | Tipo                   | Default    | Descripcion             |
| -------------- | ---------------------- | ---------- | ----------------------- |
| `value`        | `number`               | `1`        | Valor actual            |
| `min`          | `number`               | `1`        | Valor minimo            |
| `max`          | `number \| null`       | `null`     | Valor maximo            |
| `step`         | `number`               | `1`        | Incremento/decremento   |
| `editable`     | `boolean`              | `true`     | Permitir edicion manual |
| `disabled`     | `boolean`              | `false`    | Deshabilitar controles  |
| `loading`      | `boolean`              | `false`    | Estado de carga         |
| `size`         | `'sm' \| 'md' \| 'lg'` | `'sm'`     | Tamanio del control     |
| `styleVariant` | `FormStyleVariant`     | `'modern'` | Variante de estilo      |

## Outputs

| Output        | Tipo                   | Descripcion                  |
| ------------- | ---------------------- | ---------------------------- |
| `valueChange` | `EventEmitter<number>` | Emite cuando el valor cambia |

## Importante

- Usa `@Input()`/`@Output()` (NO signals) — decoradores legacy
- El input numerically filtra todo excepto digitos 0-9
- El paste solo acepta valores numericos
- `displayValue` se sincroniza desde el padre solo cuando el usuario NO esta editando
- `styleVariant` solo soporta `'modern'` actualmente (el branch classic es igual)
