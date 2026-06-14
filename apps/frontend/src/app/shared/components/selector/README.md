# Selector

Select/dropdown estilizado con soporte para opciones, labels, validacion y tooltip.
Por defecto renderiza un `<select>` nativo. Con `[searchable]="true"` cambia a un
dropdown personalizado con campo de busqueda (filtra por label y description),
manteniendo el mismo contrato `ControlValueAccessor` (valor unico).

## Uso

```html
<app-selector label="Estado" [options]="statusOptions" [(ngModel)]="selectedStatus" placeholder="Seleccionar..."></app-selector>

<!-- Con validacion -->
<app-selector label="Categoria" [options]="categoryOptions" [control]="form.get('category')" [required]="true"></app-selector>

<!-- Con busqueda (listas largas) -->
<app-selector label="Componente" [options]="ingredientOptions" formControlName="component_product_id" [searchable]="true"></app-selector>
```

## Inputs

| Input          | Tipo               | Default       | Descripcion                              |
| -------------- | ------------------ | ------------- | ---------------------------------------- |
| `id`           | `string`           | auto-generado | ID unico del select                      |
| `label`        | `string`           | `''`          | Etiqueta del campo                       |
| `placeholder`  | `string`           | `''`          | Texto placeholder                        |
| `helpText`     | `string`           | `''`          | Texto de ayuda                           |
| `errorText`    | `string`           | `''`          | Mensaje de error                         |
| `required`     | `boolean`          | `false`       | Campo requerido                          |
| `disabled`     | `boolean`          | `false`       | Deshabilita el selector                  |
| `size`         | `SelectorSize`     | `md`          | Tamanio: `sm`, `md`, `lg`                |
| `variant`      | `SelectorVariant`  | `default`     | Variante: `default`, `outline`, `filled` |
| `styleVariant` | `FormStyleVariant` | `modern`      | Estilo: `modern` o `classic`             |
| `options`      | `SelectorOption[]` | `[]`          | Lista de opciones                        |
| `tooltipText`  | `string`           | -             | Texto para tooltip de ayuda              |
| `searchable`   | `boolean`          | `false`       | Si `true`, dropdown custom con buscador  |

## SelectorOption

```typescript
interface SelectorOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  description?: string;
  icon?: string;
}
```

## Outputs

| Output        | Tipo                                     | Descripcion                      |
| ------------- | ---------------------------------------- | -------------------------------- |
| `valueChange` | `EventEmitter<string \| number \| null>` | Emite cuando cambia la seleccion |
| `blur`        | `EventEmitter<void>`                     | Emite al perder el foco          |
| `focus`       | `EventEmitter<void>`                     | Emite al enfocar                 |

## Importante

- Implementa `ControlValueAccessor` para integracion con Reactive Forms
- Usa `ChangeDetectionStrategy.OnPush`
- Alturas unificadas con Button, Input e InputButtons (mobile-first)
