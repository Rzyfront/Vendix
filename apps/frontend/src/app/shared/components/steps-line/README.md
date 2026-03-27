# steps-line

Componente de pasos (stepper) con orientacion horizontal y vertical. Soporta clic en pasos y colores personalizados.

## Uso

```html
<!-- Horizontal basico -->
<app-steps-line [steps]="steps" [currentStep]="1"></app-steps-line>

<!-- Vertical con clic -->
<app-steps-line [steps]="steps" [currentStep]="2" orientation="vertical" [clickable]="true" (stepClicked)="onStepClick($event)"></app-steps-line>

<!-- Tamanio y colores -->
<app-steps-line [steps]="steps" [currentStep]="0" size="lg" primaryColor="#3b82f6" [clickable]="true" (stepClicked)="onStepClick($event)"></app-steps-line>
```

```typescript
steps = [{ label: "Carrito" }, { label: "Pago" }, { label: "Confirmacion" }];
```

## Inputs

| Input            | Tipo                         | Default                    | Descripcion                                             |
| ---------------- | ---------------------------- | -------------------------- | ------------------------------------------------------- |
| `steps`          | `StepsLineItem[]`            | `[]`                       | Lista de pasos `{ label: string, completed?: boolean }` |
| `currentStep`    | `number`                     | `0`                        | Indice del paso actual                                  |
| `primaryColor`   | `string`                     | `'var(--color-primary)'`   | Color para pasos activos/completados                    |
| `secondaryColor` | `string`                     | `'var(--color-secondary)'` | Color secundario                                        |
| `size`           | `'sm' \| 'md' \| 'lg'`       | `'md'`                     | Tamanio de circulos                                     |
| `orientation`    | `'horizontal' \| 'vertical'` | `'horizontal'`             | Orientacion del stepper                                 |
| `clickable`      | `boolean`                    | `false`                    | Permite clic en pasos para navegar                      |

## Outputs

| Output        | Tipo                   | Descripcion                        |
| ------------- | ---------------------- | ---------------------------------- |
| `stepClicked` | `EventEmitter<number>` | Emite el indice del paso clickeado |

## Importante

- Pasos completados muestran un check SVG en lugar del numero
- El paso actual muestra un `box-shadow` de foco (glow effect)
- `primaryColor` se usa directamente en `background-color` — puede ser cualquier color CSS valido
- `primaryColorAlpha` se calcula automaticamente para el glow effect del paso actual
