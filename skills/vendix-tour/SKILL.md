# Vendix Tour System

Guía para implementar tours interactivos en la aplicación Vendix con soporte completo para **mobile y desktop**.

## Descripción

El sistema de tours permite guiar a los usuarios a través de features importantes la primera vez que los visitan. Los tours consisten en pasos secuenciales que resaltan elementos específicos de la UI con un spotlight y muestran un tooltip explicativo.

**Características clave:**
- ✅ Soporte responsive específico para mobile y desktop
- ✅ Tooltip minimizable por defecto en mobile
- ✅ Posicionamiento inteligente que no bloquea interacciones
- ✅ Detección de elementos dinámicos (ngFor)
- ✅ Safe area insets para devices con notch
- ✅ Auto-avance al hacer click en elementos target

## Arquitectura

```
apps/frontend/src/app/shared/components/tour/
├── services/
│   └── tour.service.ts           # Gestiona estado de tours (user_settings)
├── tour-modal/
│   ├── tour-modal.component.ts   # Modal con spotlight + tooltips responsive
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
  - `resetAllTours()` - Resetea todos los tours (solo para development)

## TourStep Interface (Actualizada)

```typescript
export interface TourStep {
  id: string;
  title: string;
  description: string;
  action?: string;

  // Selectores CSS
  target?: string;                     // Fallback selector
  targetMobile?: string;               // Selector específico para mobile (< 768px)
  targetDesktop?: string;              // Selector específico para desktop (≥ 768px)

  // Click detection (sin spotlight)
  autoAdvanceTarget?: string;          // Fallback
  autoAdvanceTargetMobile?: string;    // Mobile específico
  autoAdvanceTargetDesktop?: string;   // Desktop específico

  // Hooks de ciclo de vida
  beforeShow?: () => Promise<void>;
  afterShow?: () => Promise<void>;
  beforeNext?: () => Promise<boolean>; // Validación antes de avanzar
}
```

## Config Interface

```typescript
export interface TourConfig {
  id: string;
  name: string;
  steps: TourStep[];
  showProgress?: boolean;              // Muestra "X de Y" (desktop)
  showSkipButton?: boolean;            // Muestra botón "Saltar"
}
```

## Mobile-First Tour Design

### Comportamiento en Mobile vs Desktop

| Característica | Mobile (< 768px) | Desktop (≥ 768px) |
|----------------|------------------|-------------------|
| **Tooltip por defecto** | Minimizado (50px alto) | Expandido completo |
| **Botón minimizar** | Visible (flecha) | No visible |
| **Posicionamiento** | Inteligente, evita bloquear | Cerca del target |
| **Progreso** | Oculto (ahorra espacio) | Visible "X de Y" |
| **Spotlight** | Con shadow pulsante | Con shadow pulsante |
| **Safe areas** | Respeta notch/insets | No aplica |

### Selectores Específicos por Dispositivo

Para elementos que están en diferentes posiciones según el dispositivo:

```typescript
{
  id: 'checkout-step',
  target: 'app-pos-cart button.checkout-btn',  // Fallback (desktop)
  targetMobile: 'app-pos-mobile-footer button.checkout-btn',  // Footer en mobile
  targetDesktop: 'app-pos-cart button.checkout-btn',  // Cart en desktop

  autoAdvanceTarget: 'app-pos-cart button.checkout-btn',
  autoAdvanceTargetMobile: 'app-pos-mobile-footer button.checkout-btn',
  autoAdvanceTargetDesktop: 'app-pos-cart button.checkout-btn',
}
```

### Detección de Elementos Dinámicos (ngFor)

Para elementos generados dinámicamente con `*ngFor` (como cards de productos):

```typescript
{
  id: 'add-product-to-cart',
  // Selector base
  target: 'app-pos-product-selection .product-card',
  // Mobile: múltiples fallbacks por si Angular aún no renderizó
  targetMobile: 'app-pos-product-selection .product-card, ' +
                 'app-pos-product-selection .group.rounded-2xl, ' +
                 '.product-card, ' +
                 'app-pos-product-selection .grid > div > div.rounded-2xl',
}
```

**El sistema automáticamente:**
- Detecta si el selector incluye `.product-card` o `pos-product-selection`
- Usa timeout más largo (10s vs 6s) para esperar la respuesta de API + renderizado de Angular
- NO hace scroll a `top: 0` para mantener elementos en viewport
- Verifica cada 50ms (vs 100ms) para detectar más rápido cuando Angular renderiza

### Posicionamiento Inteligente en Mobile

El tooltip se posiciona automáticamente para NO bloquear el elemento target:

1. **Footer targets** (botón cobrar): Se posiciona **ENCIMA** del botón
2. **Sidebar targets**: Se posiciona **DEBAJO** del link
3. **Productos/cards**: Se posiciona **DEBAJO** del card
4. **Sin target**: Se centra en parte superior de la pantalla

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
- ✅ Para mobile: múltiples fallbacks separados por coma
- ❌ Evita `:has()` pseudo-selector (no soportado universalmente)
- ❌ Evita selectores muy genéricos (`.btn`, `.card`) sin contexto

### 2. Selectores Mobile vs Desktop

**Cuándo usar selectores específicos:**
- Elementos en diferentes posiciones (sidebar vs footer)
- Diferente estructura DOM entre mobile y desktop
- Elementos con clases diferentes según breakpoint

```typescript
// ✅ CORRECTO - Selector específico cuando difiere
{
  targetMobile: 'app-pos-mobile-footer button.checkout-btn',
  targetDesktop: 'app-pos-cart button.checkout-btn',
}

// ✅ CORRECTO - Compartido cuando es igual
{
  target: 'app-sidebar a[href="/admin/products"]',
}
```

### 3. Estructura de Pasos
- Primer paso: Welcome sin target (tooltip centrado)
- Pasos intermedios: Con target específico
- Último paso: Congratulations sin target

### 4. Elementos Dinámicos (ngFor)

**Patrón para detectar elementos generados por Angular:**

```typescript
{
  id: 'select-product',
  // Base selector (funciona en ambos)
  target: 'app-pos-product-selection .product-card',
  // Mobile: múltiples fallbacks por orden de preferencia
  targetMobile: 'app-pos-product-selection .product-card, ' +
                 'app-pos-product-selection .group.rounded-2xl, ' +
                 '.product-card',
}
```

**Clases comunes en cards dinámicos:**
- `.product-card` - clase principal del card
- `.group` - clase de Tailwind para interacciones
- `.rounded-2xl` - border-radius del card
- Combinaciones: `.group.rounded-2xl`

### 5. Validación con beforeNext
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

### 6. Testing de Tours en Mobile

**Para resetear un tour:**
```typescript
this.tourService.resetTour('my-feature-first-visit');
// O todos:
this.tourService.resetAllTours();
```

**Desde consola:**
```javascript
// Ver estado actual
JSON.parse(localStorage.getItem('user_settings')).config.tours

// Resetear tours completados
const settings = JSON.parse(localStorage.getItem('user_settings'));
settings.config.tours.completedTours = [];
localStorage.setItem('user_settings', JSON.stringify(settings));
```

**Debug logging en browser console:**
```
[TourModal] Mobile check: true, minimized: true
[TourModal] Waiting for element: app-pos-product-selection .product-card, isMobile: true
[TourModal] DOM changed, checking element (attempt 1/200)
[TourModal] Element found and visible: app-pos-product-selection .product-card
[TourModal] Mobile smart positioning: {top: 234, left: 12, ...}
```

### 7. Safe Area Insets (Notched Devices)

El tour respeta automáticamente safe areas en mobile:
- `env(safe-area-inset-top)` - notch/punch hole
- `env(safe-area-inset-bottom)` - home indicator
- `env(safe-area-inset-left/right)` - landscape notch

No necesitas configurar nada, el sistema lo maneja.

### 8. Timeout para Elementos Dinámicos

| Tipo de elemento | Mobile Timeout | Desktop Timeout |
|-----------------|----------------|-----------------|
| Estático (sidebar, header) | 6s | 8s |
| Dinámico (ngFor, API) | 10s | 8s |
| Con scroll para lazy-loading | 6s + scroll | 8s |

## Troubleshooting

### El tooltip tapa el elemento target en mobile

**Problema**: El tooltip se posiciona encima del elemento que el usuario debe clickear.

**Solución**: El sistema de posicionamiento automático debería manejar esto. Si no:
- Verifica que el selector incluye el componente contenedor correcto
- Para footer buttons, asegúrate que el selector incluye `pos-mobile-footer` o `checkout-btn`
- El sistema detecta automáticamente estos keywords y posiciona arriba

### Las cards de productos no se detectan en mobile

**Problema**: `waitForElement` termina sin encontrar las cards.

**Causas posibles**:
1. Angular aún no renderizó (ngFor dinámico)
2. El scroll a `top: 0` las sacó del viewport
3. El selector no coincide con las clases reales

**Solución**:
```typescript
// Usa múltiples fallbacks
targetMobile: 'app-pos-product-selection .product-card, ' +
               'app-pos-product-selection .group.rounded-2xl, ' +
               '.product-card',
```

### El tour avanza sin esperar la acción del usuario

**Problema**: El tour avanza automáticamente sin que el usuario complete la acción.

**Solución**: Usa `beforeNext` para validar:
```typescript
beforeNext: async () => {
  // Verifica que la acción se completó
  const cartBadge = document.querySelector('.cart-badge');
  return cartBadge?.textContent !== '0';
}
```

## Tours Existentes

| Tour ID | Config | Component | Features |
|---------|--------|-----------|----------|
| `pos-first-sale` | `POS_TOUR_CONFIG` | `PosSaleComponent` | Mobile + Desktop, dynamic elements |
| `ecommerce-config-first-visit` | `ECOMMERCE_TOUR_CONFIG` | `EcommerceComponent` | Config ecommerce |

## Archivos Clave

| Archivo | Descripción |
|---------|-------------|
| `tour.service.ts` | Gestión de estado de tours en user_settings |
| `tour-modal.component.ts` | Modal responsive con spotlight + tooltip |
| `pos-tour.config.ts` | Config del tour POS con selectores mobile/desktop |
| `pos-product-selection.component.ts` | Cards dinámicas con ngFor (*ejemplo de elementos que requieren detección especial*) |

## Referencias de Implementación

- [TourService](apps/frontend/src/app/shared/components/tour/services/tour.service.ts)
- [TourModalComponent](apps/frontend/src/app/shared/components/tour/tour-modal/tour-modal.component.ts)
- [POS Tour Config](apps/frontend/src/app/shared/components/tour/configs/pos-tour.config.ts)
- [POS Product Selection](apps/frontend/src/app/private/modules/store/pos/components/pos-product-selection.component.ts) - Ejemplo de elementos dinámicos
