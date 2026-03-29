# Textarea

Campo de texto multilinea con soporte para validacion y estilos modernos/classic.

## Uso

```html
<app-textarea label="Descripcion" placeholder="Escribe aqui..." [rows]="4" [(ngModel)]="description"></app-textarea>

<!-- Con control de formulario -->
<app-textarea label="Nota" [control]="form.get('note')"></app-textarea>
```

## Inputs

| Input                | Tipo               | Default  | Descripcion                                         |
| -------------------- | ------------------ | -------- | --------------------------------------------------- |
| `label`              | `string`           | -        | Etiqueta del campo                                  |
| `placeholder`        | `string`           | `''`     | Placeholder del textarea                            |
| `rows`               | `number`           | `3`      | Numero de filas visibles                            |
| `disabled`           | `boolean`          | `false`  | Deshabilita el campo                                |
| `readonly`           | `boolean`          | `false`  | Solo lectura                                        |
| `required`           | `boolean`          | `false`  | Campo requerido                                     |
| `error`              | `string`           | -        | Mensaje de error forzado                            |
| `helperText`         | `string`           | -        | Texto de ayuda                                      |
| `control`            | `AbstractControl`  | -        | Control de Angular Forms para validacion automatica |
| `styleVariant`       | `FormStyleVariant` | `modern` | Estilo: `modern` o `classic`                        |
| `customStyle`        | `string`           | `''`     | Estilos inline personalizados                       |
| `customWrapperClass` | `string`           | `''`     | Clases para el wrapper                              |
| `customLabelClass`   | `string`           | `''`     | Clases para el label                                |
| `customClass`        | `string`           | `''`     | Clases adicionales para el textarea                 |

## Outputs

| Output          | Tipo                   | Descripcion             |
| --------------- | ---------------------- | ----------------------- |
| `valueChange`   | `EventEmitter<string>` | Emite en cada cambio    |
| `textareaFocus` | `EventEmitter<void>`   | Emite al enfocar        |
| `textareaBlur`  | `EventEmitter<void>`   | Emite al perder el foco |

## Importante

- Implementa `ControlValueAccessor` para integracion con Reactive Forms
- El resize vertical esta habilitado por defecto (min-height 80px)
