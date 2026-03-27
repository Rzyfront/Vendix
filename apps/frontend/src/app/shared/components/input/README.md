# Input

Campo de entrada de texto con soporte para labels, iconos, validacion y estilos modernos/classic.

## Uso

```html
<app-input label="Correo electronico" type="email" placeholder="ejemplo@correo.com" [(ngModel)]="email"></app-input>

<!-- Con icono de prefijo -->
<app-input [prefixIcon]="true">
  <app-icon name="mail" slot="prefix-icon" [size]="16"></app-icon>
</app-input>

<!-- Con sufijo clickeable -->
<app-input [suffixIcon]="true" [suffixClickable]="true" (suffixClick)="onSuffixClick()">
  <app-icon name="calendar" slot="suffix-icon" [size]="16"></app-icon>
</app-input>

<!-- Con control de formulario -->
<app-input label="Nombre" [control]="form.get('name')"></app-input>
```

## Inputs

| Input                | Tipo               | Default  | Descripcion                                                                                   |
| -------------------- | ------------------ | -------- | --------------------------------------------------------------------------------------------- |
| `label`              | `string`           | -        | Etiqueta del campo                                                                            |
| `placeholder`        | `string`           | `''`     | Placeholder del input                                                                         |
| `type`               | `InputType`        | `text`   | Tipo: `text`, `email`, `password`, `number`, `tel`, `url`, `search`, `date`, `datetime-local` |
| `size`               | `InputSize`        | `md`     | Tamanio: `sm`, `md`, `lg`                                                                     |
| `styleVariant`       | `FormStyleVariant` | `modern` | Estilo: `modern` (iOS-like) o `classic`                                                       |
| `disabled`           | `boolean`          | `false`  | Deshabilita el campo                                                                          |
| `readonly`           | `boolean`          | `false`  | Solo lectura                                                                                  |
| `required`           | `boolean`          | `false`  | Campo requerido                                                                               |
| `error`              | `string`           | -        | Mensaje de error forzado                                                                      |
| `helperText`         | `string`           | -        | Texto de ayuda                                                                                |
| `prefixIcon`         | `boolean`          | `false`  | Habilita slot para icono de prefijo                                                           |
| `suffixIcon`         | `boolean`          | `false`  | Habilita slot para icono de sufijo                                                            |
| `suffixClickable`    | `boolean`          | `false`  | Hace clickeable el sufijo                                                                     |
| `control`            | `AbstractControl`  | -        | Control de Angular Forms para validacion automatica                                           |
| `step`, `min`, `max` | `string \| number` | -        | Atributos HTML para number/date                                                               |
| `tooltipText`        | `string`           | -        | Texto para tooltip de ayuda                                                                   |
| `customInputStyle`   | `string`           | `''`     | Estilos inline personalizados                                                                 |
| `customWrapperClass` | `string`           | `''`     | Clases para el wrapper                                                                        |
| `customLabelClass`   | `string`           | `''`     | Clases para el label                                                                          |
| `customInputClass`   | `string`           | `''`     | Clases adicionales para el input                                                              |

## Outputs

| Output        | Tipo                   | Descripcion                      |
| ------------- | ---------------------- | -------------------------------- |
| `inputChange` | `EventEmitter<string>` | Emite en cada cambio             |
| `inputFocus`  | `EventEmitter<void>`   | Emite al enfocar                 |
| `inputBlur`   | `EventEmitter<void>`   | Emite al perder el foco          |
| `suffixClick` | `EventEmitter<void>`   | Emite al hacer clic en el sufijo |

## Importante

- Implementa `ControlValueAccessor` para integracion con Reactive Forms
- Para `type="tel"` filtra automaticamente caracteres no validos
- El toggle de visibilidad de password es automatico para `type="password"`
