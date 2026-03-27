# app-tour-modal

Tour guiado con efecto spotlight que resalta elementos de la interfaz y muestra tooltips informativos. Soporta desktop y mobile con disenos diferenciados.

## Uso

```html
<app-tour-modal [(isOpen)]="isTourOpen" [tourConfig]="posTourConfig" (completed)="onTourComplete()" (skipped)="onTourSkipped()"> </app-tour-modal>
```

## Inputs

| Input        | Tipo         | Default           | Descripcion                     |
| ------------ | ------------ | ----------------- | ------------------------------- |
| `isOpen`     | `boolean`    | `false`           | Controla apertura del tour      |
| `tourConfig` | `TourConfig` | `POS_TOUR_CONFIG` | Configuracion de pasos del tour |

## Outputs

| Output         | Tipo                    | Descripcion                           |
| -------------- | ----------------------- | ------------------------------------- |
| `isOpenChange` | `EventEmitter<boolean>` | Emite false al cerrar                 |
| `completed`    | `void`                  | Emite al completar todos los pasos    |
| `skipped`      | `void`                  | Emite cuando el usuario salta el tour |

## Configuracion de Pasos

```typescript
interface TourStep {
  id: number;
  title: string;
  description: string;
  target?: string; // Selector CSS generico
  targetMobile?: string; // Selector para mobile
  targetDesktop?: string; // Selector para desktop
  autoAdvanceTarget?: string; // Click automatico para avanzar
  beforeShow?: () => Promise<void>; // Hook antes de mostrar
  beforeNext?: () => Promise<boolean>; // Hook de validacion
}
```

## Importante

- `TourService` persiste el estado de tours completados/saltados.
- En mobile, el tooltip es compact y se puede minimizar para no bloquear contenido.
- `waitForElement()` hasta 8s para esperar que elementos dinamicos (cards de productos) aparezcan en el DOM.
- MutationObserver y ResizeObserver para reposicionar el spotlight ante cambios del DOM.
- El overlay del spotlight usa `box-shadow` con `9999px` de spread para oscurecer todo excepto el elemento resaltado.
- Click listener en fase de captura para detectar clicks antes que otros componentes.
- `isParentModuleEnabled()` en `settings-modal` deshabilita hijos si el modulo padre esta apagado.
