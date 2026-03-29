# MultiSelector

Selector multiple con dropdown, chips de seleccion y busqueda integrada.

## Uso

```html
<app-multi-selector label="Categorias" [options]="categoryOptions" [(ngModel)]="selectedCategories" placeholder="Seleccionar categorias..."></app-multi-selector>

<!-- Con validacion -->
<app-multi-selector label="Etiquetas" [options]="tagOptions" [control]="form.get('tags')" [required]="true"></app-multi-selector>
```

## Inputs

| Input          | Tipo                    | Default            | Descripcion                  |
| -------------- | ----------------------- | ------------------ | ---------------------------- |
| `label`        | `string`                | `''`               | Etiqueta del campo           |
| `placeholder`  | `string`                | `'Seleccionar...'` | Texto placeholder            |
| `helpText`     | `string`                | `''`               | Texto de ayuda               |
| `errorText`    | `string`                | `''`               | Mensaje de error             |
| `required`     | `boolean`               | `false`            | Campo requerido              |
| `disabled`     | `boolean`               | `false`            | Deshabilita el selector      |
| `size`         | `MultiSelectorSize`     | `md`               | Tamanio: `sm`, `md`, `lg`    |
| `styleVariant` | `FormStyleVariant`      | `modern`           | Estilo: `modern` o `classic` |
| `options`      | `MultiSelectorOption[]` | `[]`               | Lista de opciones            |

## MultiSelectorOption

```typescript
interface MultiSelectorOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  description?: string;
  icon?: string;
}
```

## Outputs

| Output        | Tipo                                 | Descripcion                          |
| ------------- | ------------------------------------ | ------------------------------------ |
| `valueChange` | `EventEmitter<(string \| number)[]>` | Emite array de valores seleccionados |

## Importante

- Implementa `ControlValueAccessor` para integracion con Reactive Forms
- El dropdown se cierra automaticamente al hacer clic fuera
- Incluye input de busqueda con filtro en tiempo real
- Las chips muestran las opciones seleccionadas y permiten eliminarlas individualmente
