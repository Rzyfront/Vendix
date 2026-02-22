# Vendix Tour System

Guía para implementar tours interactivos en la aplicación Vendix.

## Descripción

El sistema de tours permite guiar a los usuarios a través de features importantes la primera vez que los visitan. Los tours consisten en pasos secuenciales que resaltan elementos específicos de la UI con un spotlight y muestran un tooltip explicativo.

## Arquitectura

```
apps/frontend/src/app/shared/components/tour/
├── services/
│   └── tour.service.ts           # Gestiona estado de tours (localStorage)
├── tour-modal/
│   ├── tour-modal.component.ts   # Modal con spotlight + tooltips
│   └── tour-modal.component.scss
└── configs/
    ├── pos-tour.config.ts        # Tour del POS
    └── ecommerce-tour.config.ts  # Tour de configuración ecommerce
```

## TourService

Servicio singleton que gestiona:

- **Estado de tours**: Guarda en `user_settings.config.tours` qué tours están completados/saltados
- **Métodos**:
  - `canShowTour(tourId)` - Verifica si el tour puede mostrarse
  - `completeTour(tourId)` - Marca tour como completado
  - `skipTour(tourId)` - Marca tour como saltado
  - `resetTour(tourId)` - Resetea tour para testing

## TourConfig Interface

```typescript
export interface TourConfig {
  id: string;                          // ID único del tour
  name: string;                        // Nombre del tour
  showProgress?: boolean;              // Mostrar contador X/Y
  showSkipButton?: boolean;            // Mostrar botón "Saltar"
  steps: TourStep[];                   // Pasos del tour
}

export interface TourStep {
  id: string;                          // ID único del paso
  title: string;                       // Título del tooltip
  description: string;                 // Descripción del tooltip
  action?: string;                     // Texto de acción a realizar
  target?: string;                     // Selector CSS del elemento a resaltar
  autoAdvanceTarget?: string;          // Target para click-detection (sin spotlight)
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  beforeShow?: () => Promise<void>;
  afterShow?: () => Promise<void>;
  beforeNext?: () => Promise<boolean>; // Validación antes de avanzar
}
```

## Implementación de un Nuevo Tour

### 1. Crear el config del tour

**Archivo**: `apps/frontend/src/app/shared/components/tour/configs/my-feature-tour.config.ts`

```typescript
import { TourConfig } from '../services/tour.service';

export const MY_FEATURE_TOUR_CONFIG: TourConfig = {
  id: 'my-feature-first-visit',
  name: 'Tour de Mi Feature',
  showProgress: true,
  showSkipButton: true,
  steps: [
    {
      id: 'welcome',
      title: '¡Bienvenido a Mi Feature! 🎉',
      description: 'Descripción de lo que hace el feature.',
      action: 'Haz clic en "Comenzar"',
    },
    {
      id: 'important-element',
      title: 'Elemento Importante',
      description: 'Explicación de este elemento.',
      action: 'Revisa este elemento',
      target: '[data-tour="important-element"]', // Usar data-tour attributes
    },
    {
      id: 'congratulations',
      title: '¡Tour Completado!',
      description: 'Has completado el tour.',
      action: '¡Comienza a usar el feature!',
    },
  ],
};
```

### 2. Agregar data-tour attributes al HTML

**IMPORTANTE**: Usa atributos `data-tour` en lugar de selectores CSS complejos con `:has()`:

```html
<!-- ✅ CORRECTO -->
<div class="bg-white rounded-xl" data-tour="important-section">
  ...
</div>

<!-- ❌ EVITAR - no soportado en todos los navegadores -->
<div class="bg-white:has(.fa-icon)">
```

Selectores recomendados:
- `[data-tour="section-id"]` - Attribute selector (más confiable)
- `app-my-component` - Component selector
- `.specific-class` - Class selector simple
- `#element-id` - ID selector

### 3. Integrar en el componente

```typescript
import { TourModalComponent } from '../../../../shared/components/tour/tour-modal/tour-modal.component';
import { TourService } from '../../../../shared/components/tour/services/tour.service';
import { MY_FEATURE_TOUR_CONFIG } from '../../../../shared/components/tour/configs/my-feature-tour.config';

@Component({
  standalone: true,
  imports: [TourModalComponent, /* ... */],
  template: `
    <!-- ... contenido del componente ... -->

    <!-- Tour Modal -->
    <app-tour-modal
      [isOpen]="showTourModal"
      [tourConfig]="myFeatureTourConfig"
      (completed)="onTourCompleted()"
      (skipped)="onTourSkipped()">
    </app-tour-modal>
  `
})
export class MyFeatureComponent implements OnInit {
  private tourService = inject(TourService);
  showTourModal = false;
  readonly myFeatureTourConfig = MY_FEATURE_TOUR_CONFIG;

  ngOnInit(): void {
    this.checkAndStartTour();
  }

  private checkAndStartTour(): void {
    const tourId = 'my-feature-first-visit';
    if (this.tourService.canShowTour(tourId)) {
      setTimeout(() => {
        this.showTourModal = true;
      }, 1500); // Delay para que la página se asiente
    }
  }

  onTourCompleted(): void {
    this.showTourModal = false;
  }

  onTourSkipped(): void {
    this.showTourModal = false;
  }
}
```

## Buenas Prácticas

### 1. Selectores de Target
- ✅ Usa `[data-tour="..."]` attributes para elementos específicos
- ✅ Usa selectores de componente `app-my-component`
- ✅ Usa clases únicas con prefijo `.my-feature-section`
- ❌ Evita `:has()` pseudo-selector (no soportado universalmente)
- ❌ Evita selectores muy genéricos (`.btn`, `.card`)

### 2. Estructura de Pasos
- Primer paso: Welcome sin target (tooltip centrado)
- Pasos intermedios: Con target específico
- Último paso: Congratulations sin target

### 3. Validación con beforeNext
```typescript
{
  id: 'action-required',
  target: '[data-tour="action-section"]',
  beforeNext: async () => {
    // Verificar que el usuario completó la acción
    const element = document.querySelector('[data-tour="action-section"]');
    return element?.classList.contains('completed') ?? false;
  }
}
```

### 4. Testing
Para resetear un tour durante desarrollo:
```typescript
this.tourService.resetTour('my-feature-first-visit');
```

O desde consola:
```javascript
JSON.parse(localStorage.getItem('user_settings')).config.tours.completedTours = []
```

## Tours Existentes

| Tour ID | Config | Component |
|---------|--------|-----------|
| `pos-first-sale` | `POS_TOUR_CONFIG` | `PosSaleComponent` |
| `ecommerce-config-first-visit` | `ECOMMERCE_TOUR_CONFIG` | `EcommerceComponent` |

## Referencias

- [TourService](apps/frontend/src/app/shared/components/tour/services/tour.service.ts)
- [TourModalComponent](apps/frontend/src/app/shared/components/tour/tour-modal/tour-modal.component.ts)
- [Ecommerce Tour Config](apps/frontend/src/app/shared/components/tour/configs/ecommerce-tour.config.ts)
