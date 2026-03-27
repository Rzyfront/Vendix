# Toggle

Interruptor on/off (switch) con animacion y soporte para Reactive Forms.

## Uso

```html
<app-toggle [(ngModel)]="isEnabled" label="Activar notificacion"></app-toggle>

<!-- Solo interruptor, sin texto -->
<app-toggle [(ngModel)]="isActive"></app-toggle>

<!-- Con variante classic -->
<app-toggle [(ngModel)]="value" [styleVariant]="'classic'"></app-toggle>
```

## Inputs

| Input          | Tipo               | Default  | Descripcion                  |
| -------------- | ------------------ | -------- | ---------------------------- |
| `checked`      | `boolean`          | `false`  | Estado del toggle            |
| `disabled`     | `boolean`          | `false`  | Deshabilita el toggle        |
| `label`        | `string`           | -        | Texto junto al toggle        |
| `ariaLabel`    | `string`           | -        | Label de accesibilidad       |
| `styleVariant` | `FormStyleVariant` | `modern` | Estilo: `modern` o `classic` |

## Outputs

| Output    | Tipo                    | Descripcion                            |
| --------- | ----------------------- | -------------------------------------- |
| `toggled` | `EventEmitter<boolean>` | Emite en cada cambio de estado         |
| `changed` | `EventEmitter<boolean>` | Alias de `toggled` para compatibilidad |

## Importante

- Implementa `ControlValueAccessor` para integracion con Reactive Forms
- Usa `aria-pressed` para accesibilidad
