# Vendix Tour System

Guide for implementing interactive tours in the Vendix application with full support for **mobile and desktop**.

## Description

> **Tip**: Antes de usar app-tour, consulta su README en `apps/frontend/src/app/shared/components/tour/README.md` para conocer sus inputs, outputs, configuraciones y patrones de uso.

The tour system allows guiding users through important features the first time they visit them. Tours consist of sequential steps that highlight specific UI elements with a spotlight and display an explanatory tooltip.

**Key features:**

- ✅ Specific responsive support for mobile and desktop
- ✅ Tooltip minimizable by default on mobile
- ✅ Smart positioning that does not block interactions
- ✅ Dynamic element detection (ngFor)
- ✅ Safe area insets for devices with notch
- ✅ Auto-advance on click on target elements

## Architecture

```
apps/frontend/src/app/shared/components/tour/
├── services/
│   └── tour.service.ts           # Manages tour state (user_settings)
├── tour-modal/
│   ├── tour-modal.component.ts   # Modal with spotlight + responsive tooltips
│   └── tour-modal.component.scss
└── configs/
    ├── pos-tour.config.ts        # POS Tour
    └── ecommerce-tour.config.ts  # Ecommerce configuration tour
```

## TourService

Singleton service that manages:

- **Tour state**: Stores in `user_settings.config.tours` which tours are completed/skipped
- **Methods**:
  - `canShowTour(tourId)` - Checks if the tour can be shown
  - `completeTour(tourId)` - Marks tour as completed
  - `skipTour(tourId)` - Marks tour as skipped
  - `resetTour(tourId)` - Resets tour for testing
  - `resetAllTours()` - Resets all tours (development only)

## TourStep Interface (Updated)

```typescript
export interface TourStep {
  id: string;
  title: string;
  description: string;
  action?: string;

  // CSS Selectors
  target?: string; // Fallback selector
  targetMobile?: string; // Mobile-specific selector (< 768px)
  targetDesktop?: string; // Desktop-specific selector (≥ 768px)

  // Click detection (without spotlight)
  autoAdvanceTarget?: string; // Fallback
  autoAdvanceTargetMobile?: string; // Mobile-specific
  autoAdvanceTargetDesktop?: string; // Desktop-specific

  // Lifecycle hooks
  beforeShow?: () => Promise<void>;
  afterShow?: () => Promise<void>;
  beforeNext?: () => Promise<boolean>; // Validation before advancing
}
```

## Config Interface

```typescript
export interface TourConfig {
  id: string;
  name: string;
  steps: TourStep[];
  showProgress?: boolean; // Shows "X of Y" (desktop)
  showSkipButton?: boolean; // Shows "Skip" button
}
```

## Mobile-First Tour Design

### Behavior on Mobile vs Desktop

| Feature             | Mobile (< 768px)        | Desktop (≥ 768px)     |
| ------------------- | ----------------------- | --------------------- |
| **Default tooltip** | Minimized (50px height) | Fully expanded        |
| **Minimize button** | Visible (arrow)         | Not visible           |
| **Positioning**     | Smart, avoids blocking  | Near the target       |
| **Progress**        | Hidden (saves space)    | Visible "X of Y"      |
| **Spotlight**       | With pulsating shadow   | With pulsating shadow |
| **Safe areas**      | Respects notch/insets   | Not applicable        |

### Device-Specific Selectors

For elements that are in different positions depending on the device:

```typescript
{
  id: 'checkout-step',
  target: 'app-pos-cart button.checkout-btn',  // Fallback (desktop)
  targetMobile: 'app-pos-mobile-footer button.checkout-btn',  // Footer on mobile
  targetDesktop: 'app-pos-cart button.checkout-btn',  // Cart on desktop

  autoAdvanceTarget: 'app-pos-cart button.checkout-btn',
  autoAdvanceTargetMobile: 'app-pos-mobile-footer button.checkout-btn',
  autoAdvanceTargetDesktop: 'app-pos-cart button.checkout-btn',
}
```

### Dynamic Element Detection (ngFor)

For elements dynamically generated with `*ngFor` (such as product cards):

```typescript
{
  id: 'add-product-to-cart',
  // Base selector
  target: 'app-pos-product-selection .product-card',
  // Mobile: multiple fallbacks in case Angular has not yet rendered
  targetMobile: 'app-pos-product-selection .product-card, ' +
                 'app-pos-product-selection .group.rounded-2xl, ' +
                 '.product-card, ' +
                 'app-pos-product-selection .grid > div > div.rounded-2xl',
}
```

**The system automatically:**

- Detects if the selector includes `.product-card` or `pos-product-selection`
- Uses a longer timeout (10s vs 6s) to wait for the API response + Angular rendering
- Does NOT scroll to `top: 0` to keep elements in the viewport
- Checks every 50ms (vs 100ms) to detect faster when Angular renders

### Smart Positioning on Mobile

The tooltip is automatically positioned so it does NOT block the target element:

1. **Footer targets** (checkout button): Positioned **ABOVE** the button
2. **Sidebar targets**: Positioned **BELOW** the link
3. **Products/cards**: Positioned **BELOW** the card
4. **No target**: Centered at the top of the screen

## Implementing a New Tour

### 1. Create the tour config

**File**: `apps/frontend/src/app/shared/components/tour/configs/my-feature-tour.config.ts`

```typescript
import { TourConfig } from "../services/tour.service";

export const MY_FEATURE_TOUR_CONFIG: TourConfig = {
  id: "my-feature-first-visit",
  name: "My Feature Tour",
  showProgress: true,
  showSkipButton: true,
  steps: [
    {
      id: "welcome",
      title: "Welcome to My Feature! 🎉",
      description: "Description of what the feature does.",
      action: 'Click "Get Started"',
    },
    {
      id: "important-element",
      title: "Important Element",
      description: "Explanation of this element.",
      action: "Review this element",
      target: '[data-tour="important-element"]', // Use data-tour attributes
    },
    {
      id: "congratulations",
      title: "Tour Completed!",
      description: "You have completed the tour.",
      action: "Start using the feature!",
    },
  ],
};
```

### 2. Add data-tour attributes to HTML

**IMPORTANT**: Use `data-tour` attributes instead of complex CSS selectors with `:has()`:

```html
<!-- ✅ CORRECT -->
<div class="bg-white rounded-xl" data-tour="important-section">...</div>

<!-- ❌ AVOID - not supported in all browsers -->
<div class="bg-white:has(.fa-icon)"></div>
```

Recommended selectors:

- `[data-tour="section-id"]` - Attribute selector (most reliable)
- `app-my-component` - Component selector
- `.specific-class` - Simple class selector
- `#element-id` - ID selector

### 3. Integrate into the component

```typescript
import { TourModalComponent } from "../../../../shared/components/tour/tour-modal/tour-modal.component";
import { TourService } from "../../../../shared/components/tour/services/tour.service";
import { MY_FEATURE_TOUR_CONFIG } from "../../../../shared/components/tour/configs/my-feature-tour.config";

@Component({
  standalone: true,
  imports: [TourModalComponent /* ... */],
  template: `
    <!-- ... component content ... -->

    <!-- Tour Modal -->
    <app-tour-modal
      [isOpen]="showTourModal"
      [tourConfig]="myFeatureTourConfig"
      (completed)="onTourCompleted()"
      (skipped)="onTourSkipped()"
    >
    </app-tour-modal>
  `,
})
export class MyFeatureComponent implements OnInit {
  private tourService = inject(TourService);
  showTourModal = false;
  readonly myFeatureTourConfig = MY_FEATURE_TOUR_CONFIG;

  ngOnInit(): void {
    this.checkAndStartTour();
  }

  private checkAndStartTour(): void {
    const tourId = "my-feature-first-visit";
    if (this.tourService.canShowTour(tourId)) {
      setTimeout(() => {
        this.showTourModal = true;
      }, 1500); // Delay so the page settles
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

## Best Practices

### 1. Target Selectors

- ✅ Use `[data-tour="..."]` attributes for specific elements
- ✅ Use component selectors `app-my-component`
- ✅ Use unique classes with prefix `.my-feature-section`
- ✅ For mobile: multiple fallbacks separated by comma
- ❌ Avoid `:has()` pseudo-selector (not universally supported)
- ❌ Avoid very generic selectors (`.btn`, `.card`) without context

### 2. Mobile vs Desktop Selectors

**When to use specific selectors:**

- Elements in different positions (sidebar vs footer)
- Different DOM structure between mobile and desktop
- Elements with different classes depending on breakpoint

```typescript
// ✅ CORRECT - Specific selector when it differs
{
  targetMobile: 'app-pos-mobile-footer button.checkout-btn',
  targetDesktop: 'app-pos-cart button.checkout-btn',
}

// ✅ CORRECT - Shared when identical
{
  target: 'app-sidebar a[href="/admin/products"]',
}
```

### 3. Step Structure

- First step: Welcome without target (centered tooltip)
- Intermediate steps: With specific target
- Last step: Congratulations without target

### 4. Dynamic Elements (ngFor)

**Pattern for detecting Angular-generated elements:**

```typescript
{
  id: 'select-product',
  // Base selector (works on both)
  target: 'app-pos-product-selection .product-card',
  // Mobile: multiple fallbacks in order of preference
  targetMobile: 'app-pos-product-selection .product-card, ' +
                 'app-pos-product-selection .group.rounded-2xl, ' +
                 '.product-card',
}
```

**Common classes in dynamic cards:**

- `.product-card` - main card class
- `.group` - Tailwind class for interactions
- `.rounded-2xl` - card border-radius
- Combinations: `.group.rounded-2xl`

### 5. Validation with beforeNext

```typescript
{
  id: 'action-required',
  target: '[data-tour="action-section"]',
  beforeNext: async () => {
    // Verify that the user completed the action
    const element = document.querySelector('[data-tour="action-section"]');
    return element?.classList.contains('completed') ?? false;
  }
}
```

### 6. Testing Tours on Mobile

**To reset a tour:**

```typescript
this.tourService.resetTour("my-feature-first-visit");
// Or all:
this.tourService.resetAllTours();
```

**From the console:**

```javascript
// View current state
JSON.parse(localStorage.getItem("user_settings")).config.tours;

// Reset completed tours
const settings = JSON.parse(localStorage.getItem("user_settings"));
settings.config.tours.completedTours = [];
localStorage.setItem("user_settings", JSON.stringify(settings));
```

**Debug logging in browser console:**

```
[TourModal] Mobile check: true, minimized: true
[TourModal] Waiting for element: app-pos-product-selection .product-card, isMobile: true
[TourModal] DOM changed, checking element (attempt 1/200)
[TourModal] Element found and visible: app-pos-product-selection .product-card
[TourModal] Mobile smart positioning: {top: 234, left: 12, ...}
```

### 7. Safe Area Insets (Notched Devices)

The tour automatically respects safe areas on mobile:

- `env(safe-area-inset-top)` - notch/punch hole
- `env(safe-area-inset-bottom)` - home indicator
- `env(safe-area-inset-left/right)` - landscape notch

No configuration needed, the system handles it.

### 8. Timeout for Dynamic Elements

| Element type                 | Mobile Timeout | Desktop Timeout |
| ---------------------------- | -------------- | --------------- |
| Static (sidebar, header)     | 6s             | 8s              |
| Dynamic (ngFor, API)         | 10s            | 8s              |
| With scroll for lazy-loading | 6s + scroll    | 8s              |

## Troubleshooting

### The tooltip covers the target element on mobile

**Problem**: The tooltip is positioned on top of the element the user needs to click.

**Solution**: The automatic positioning system should handle this. If not:

- Verify that the selector includes the correct container component
- For footer buttons, make sure the selector includes `pos-mobile-footer` or `checkout-btn`
- The system automatically detects these keywords and positions above

### Product cards are not detected on mobile

**Problem**: `waitForElement` finishes without finding the cards.

**Possible causes**:

1. Angular has not yet rendered (dynamic ngFor)
2. Scrolling to `top: 0` moved them out of the viewport
3. The selector does not match the actual classes

**Solution**:

```typescript
// Use multiple fallbacks
targetMobile: 'app-pos-product-selection .product-card, ' +
               'app-pos-product-selection .group.rounded-2xl, ' +
               '.product-card',
```

### The tour advances without waiting for the user's action

**Problem**: The tour advances automatically without the user completing the action.

**Solution**: Use `beforeNext` to validate:

```typescript
beforeNext: async () => {
  // Verify that the action was completed
  const cartBadge = document.querySelector(".cart-badge");
  return cartBadge?.textContent !== "0";
};
```

## Existing Tours

| Tour ID                        | Config                  | Component            | Features                           |
| ------------------------------ | ----------------------- | -------------------- | ---------------------------------- |
| `pos-first-sale`               | `POS_TOUR_CONFIG`       | `PosSaleComponent`   | Mobile + Desktop, dynamic elements |
| `ecommerce-config-first-visit` | `ECOMMERCE_TOUR_CONFIG` | `EcommerceComponent` | Ecommerce config                   |

## Key Files

| File                                 | Description                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `tour.service.ts`                    | Tour state management in user_settings                                       |
| `tour-modal.component.ts`            | Responsive modal with spotlight + tooltip                                    |
| `pos-tour.config.ts`                 | POS tour config with mobile/desktop selectors                                |
| `pos-product-selection.component.ts` | Dynamic cards with ngFor (_example of elements requiring special detection_) |

## Implementation References

- [TourService](apps/frontend/src/app/shared/components/tour/services/tour.service.ts)
- [TourModalComponent](apps/frontend/src/app/shared/components/tour/tour-modal/tour-modal.component.ts)
- [POS Tour Config](apps/frontend/src/app/shared/components/tour/configs/pos-tour.config.ts)
- [POS Product Selection](apps/frontend/src/app/private/modules/store/pos/components/pos-product-selection.component.ts) - Example of dynamic elements
