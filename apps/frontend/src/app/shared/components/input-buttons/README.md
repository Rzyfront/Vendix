# InputButtons

Grupo de botones estilo tabs para seleccion de opciones mutuamente excluyentes.

## Uso

```html
<app-input-buttons label="Metodo de envio" [options]="shippingOptions" [(ngModel)]="selectedShipping"></app-input-buttons>

<!-- Con validacion y tooltip -->
<app-input-buttons label="Prioridad" [options]="priorityOptions" [control]="form.get('priority')" [required]="true" tooltipText="Selecciona la prioridad del ticket"></app-input-buttons>
```

## Inputs

| Input                | Tipo                  | Default  | Descripcion                  |
| -------------------- | --------------------- | -------- | ---------------------------- |
| `label`              | `string`              | -        | Etiqueta del grupo           |
| `options`            | `InputButtonOption[]` | `[]`     | Lista de opciones            |
| `disabled`           | `boolean`             | `false`  | Deshabilita todo el grupo    |
| `required`           | `boolean`             | `false`  | Campo requerido              |
| `helperText`         | `string`              | -        | Texto de ayuda               |
| `tooltipText`        | `string`              | -        | Texto para tooltip de ayuda  |
| `styleVariant`       | `FormStyleVariant`    | `modern` | Estilo: `modern` o `classic` |
| `customWrapperClass` | `string`              | `''`     | Clases para el wrapper       |

## InputButtonOption

```typescript
interface InputButtonOption {
  value: string;
  label: string;
}
```

## Outputs

| Output        | Tipo                   | Descripcion                              |
| ------------- | ---------------------- | ---------------------------------------- |
| `valueChange` | `EventEmitter<string>` | Emite el valor de la opcion seleccionada |

## Importante

- Implementa `ControlValueAccessor` para integracion con Reactive Forms
- Solo una opcion puede estar seleccionada a la vez
- El grupo tiene altura fija de 40px mobile / 44px desktop (unificado con Input/Selector)
