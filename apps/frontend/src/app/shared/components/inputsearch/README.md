# InputSearch

Campo de busqueda con icono de lupa, boton de limpiar y debounce integrado.

## Uso

```html
<app-inputsearch placeholder="Buscar productos..." [(ngModel)]="searchQuery" (searchChange)="onSearch($event)"></app-inputsearch>

<!-- Con debounce personalizado -->
<app-inputsearch [debounceTime]="500" (search)="onSearch($event)"></app-inputsearch>

<!-- Con enter key handler -->
<app-inputsearch placeholder="Buscar..." (enter)="onEnter()" (escape)="onEscape()"></app-inputsearch>
```

## Inputs

| Input           | Tipo                                     | Default       | Descripcion                                           |
| --------------- | ---------------------------------------- | ------------- | ----------------------------------------------------- |
| `type`          | `'text' \| 'search' \| 'email' \| 'url'` | `text`        | Tipo de input                                         |
| `placeholder`   | `string`                                 | `'Buscar...'` | Placeholder                                           |
| `disabled`      | `boolean`                                | `false`       | Deshabilita el campo                                  |
| `readonly`      | `boolean`                                | `false`       | Solo lectura                                          |
| `required`      | `boolean`                                | `false`       | Campo requerido                                       |
| `showClear`     | `boolean`                                | `true`        | Muestra boton de limpiar cuando hay texto             |
| `size`          | `InputSearchSize`                        | `md`          | Tamanio: `sm`, `md`, `lg`                             |
| `styleVariant`  | `FormStyleVariant`                       | `modern`      | Estilo: `modern` o `classic`                          |
| `debounceTime`  | `number`                                 | `300`         | Milisegundos de debounce para `searchChange`/`search` |
| `helpText`      | `string`                                 | `''`          | Texto de ayuda                                        |
| `errorMessage`  | `string`                                 | `''`          | Mensaje de error                                      |
| `customClasses` | `string`                                 | `''`          | Clases CSS adicionales                                |

## Outputs

| Output         | Tipo                   | Descripcion                          |
| -------------- | ---------------------- | ------------------------------------ |
| `searchChange` | `EventEmitter<string>` | Emite con debounce en cada cambio    |
| `search`       | `EventEmitter<string>` | Alias de `searchChange` con debounce |
| `focus`        | `EventEmitter<void>`   | Emite al enfocar                     |
| `blur`         | `EventEmitter<void>`   | Emite al perder el foco              |
| `enter`        | `EventEmitter<void>`   | Emite al presionar Enter             |
| `escape`       | `EventEmitter<void>`   | Emite al presionar Escape            |
| `clear`        | `EventEmitter<void>`   | Emite al hacer clic en limpiar       |

## Importante

- Implementa `ControlValueAccessor` para integracion con Reactive Forms
- `searchChange` y `search` emiten con debounce configurable
- `enter` y `escape` emiten inmediatamente (sin debounce)
