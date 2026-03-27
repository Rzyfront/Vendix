# timeline

Timeline colapsable para mostrar sequences de eventos (ordenes, envios, estados). Soporta plantilla custom para cada paso.

## Uso

```html
<!-- Basico con steps definidos -->
<app-timeline [steps]="orderSteps"></app-timeline>

<!-- Collapsible con labels custom -->
<app-timeline [steps]="orderSteps" [collapsible]="true" expandLabel="Ver progreso completo" collapseLabel="Ocultar" size="md"></app-timeline>

<!-- Con plantilla custom -->
<app-timeline [steps]="orderSteps">
  <ng-template #stepTemplate let-step let-index="index">
    <div class="custom-step">
      <strong>{{ step.label }}</strong>
      <span>{{ step.description }}</span>
    </div>
  </ng-template>
</app-timeline>
```

```typescript
orderSteps: TimelineStep[] = [
  { key: 'ordered', label: 'Orden recibida', status: 'completed', date: '26 Mar' },
  { key: 'processing', label: 'Procesando', status: 'current', description: 'Preparando envio' },
  { key: 'shipped', label: 'Enviado', status: 'upcoming' },
  { key: 'delivered', label: 'Entregado', status: 'pending' },
];
```

## Inputs

| Input           | Tipo             | Default                   | Descripcion               |
| --------------- | ---------------- | ------------------------- | ------------------------- |
| `steps`         | `TimelineStep[]` | `required`                | Lista de pasos            |
| `collapsible`   | `boolean`        | `true`                    | Permite colapsar/expandir |
| `expandLabel`   | `string`         | `'Ver timeline completo'` | Label del boton expandir  |
| `collapseLabel` | `string`         | `'Ocultar timeline'`      | Label del boton colapsar  |
| `size`          | `'sm' \| 'md'`   | `'md'`                    | Tamanio del timeline      |

## Plantilla

| Context         | Tipo          | Descripcion               |
| --------------- | ------------- | ------------------------- |
| `#stepTemplate` | `TemplateRef` | Plantilla custom por paso |

Template context: `{ $implicit: TimelineStep, index: number, isLast: boolean }`

## Tipos

```typescript
type TimelineStepStatus = "completed" | "current" | "upcoming" | "pending" | "terminal";
type TimelineVariant = "success" | "danger" | "warning" | "default";
type TimelineSize = "sm" | "md";

interface TimelineStep {
  key: string;
  label: string;
  status: TimelineStepStatus;
  variant?: TimelineVariant;
  description?: string;
  date?: string;
  data?: any;
}
```

## Importante

- `collapsible=false` muestra siempre el timeline completo
- Cuando se colapsa, solo muestra el paso "actual" o el ultimo completado
- El boton de toggle solo aparece si `collapsible=true`
- `key` es requerido para `track` en el `@for`
