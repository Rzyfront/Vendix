# Tour System - Scalability Analysis

## Architecture Overview

The tour system is designed with a modular, scalable architecture that allows easy addition of new tours across different application contexts (STORE_ADMIN, ORG_ADMIN, STORE_ECOMMERCE).

## Current Architecture

```
src/app/shared/components/tour/
├── tour-modal/
│   └── tour-modal.component.ts       # Reusable tour UI component
├── services/
│   ├── tour.service.ts               # State management (localStorage)
│   └── tour-init.service.ts          # Tour initialization logic
└── configs/
    ├── pos-tour.config.ts            # POS First Sale tour
    └── [future tours...]
```

## Adding New Tours - Step by Step

### 1. Create a New Tour Configuration

Create a new config file in `configs/`:

```typescript
// configs/ecommerce-onboarding-tour.config.ts
import { TourConfig } from '../services/tour.service';

export const ECOMMERCE_ONBOARDING_TOUR: TourConfig = {
  id: 'ecommerce-onboarding',
  name: 'Configuración de Tienda Online',
  showProgress: true,
  showSkipButton: true,
  steps: [
    {
      id: 'welcome',
      title: '¡Bienvenido a Vendix E-commerce!',
      description: 'Configura tu tienda online en minutos.',
      action: 'Comencemos',
    },
    // ... more steps
  ],
};
```

### 2. Register the Tour in the Layout

**File**: `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`

```typescript
import { ECOMMERCE_ONBOARDING_TOUR } from '@shared/components/tour/configs/ecommerce-onboarding-tour.config';

@Component({ ... })
export class StoreAdminLayoutComponent {
  showTourModal = false;
  activeTourConfig: TourConfig = POS_TOUR_CONFIG; // Default

  checkAndStartTour(tourId?: string): void {
    const tourToStart = tourId || this.getDefaultTour();
    if (this.tourService.canShowTour(tourToStart)) {
      this.activeTourConfig = this.getTourConfig(tourToStart);
      this.showTourModal = true;
    }
  }

  private getTourConfig(id: string): TourConfig {
    switch(id) {
      case 'ecommerce-onboarding':
        return ECOMMERCE_ONBOARDING_TOUR;
      case 'pos-first-sale':
      default:
        return POS_TOUR_CONFIG;
    }
  }
}
```

### 3. Backend Integration for Auto-Start

**File**: `apps/backend/src/domains/organization/onboarding/onboarding-wizard.service.ts`

```typescript
// In the completeOnboarding method
config: {
  // ... existing config
  tour: {
    startTour: true,
    tourId: 'ecommerce-onboarding', // Dynamic tour ID
    appType: 'STORE_ADMIN',
  }
}
```

### 4. Export from Index

**File**: `apps/frontend/src/app/shared/components/tour/index.ts`

```typescript
export * from './tour-modal/tour-modal.component';
export * from './services/tour.service';
export * from './configs/pos-tour.config';
export * from './configs/ecommerce-onboarding-tour.config'; // New export
```

## Scaling Considerations

### 1. **Multiple Tours per Context**

For different user journeys within the same app:

```typescript
// tours/index.ts - Centralized tour registry
export const TOUR_REGISTRY: Record<string, TourConfig> = {
  'pos-first-sale': POS_TOUR_CONFIG,
  'ecommerce-onboarding': ECOMMERCE_ONBOARDING_TOUR,
  'inventory-management': INVENTORY_TOUR_CONFIG,
  'reporting-101': REPORTING_TOUR_CONFIG,
};

export function getTourConfig(id: string): TourConfig {
  return TOUR_REGISTRY[id] || TOUR_REGISTRY['pos-first-sale'];
}
```

### 2. **Role-Based Tours**

Different tours for different user roles:

```typescript
// In layout component
checkAndStartTour(): void {
  const userRole = this.authFacade.userRole;
  const tourId = this.getTourForRole(userRole);

  if (this.tourService.canShowTour(tourId)) {
    this.activeTourConfig = getTourConfig(tourId);
    this.showTourModal = true;
  }
}

private getTourForRole(role: string): string {
  const roleTourMap = {
    'admin': 'admin-dashboard-tour',
    'cashier': 'pos-basics-tour',
    'manager': 'reporting-tour',
  };
  return roleTourMap[role] || 'pos-first-sale';
}
```

### 3. **Conditional Steps**

Dynamic steps based on application state:

```typescript
export const DYNAMIC_TOUR: TourConfig = {
  id: 'dynamic-tour',
  name: 'Tour Adaptativo',
  steps: [
    {
      id: 'check-feature',
      title: 'Configuración',
      // Skip this step if feature is already enabled
      beforeShow: async () => {
        const featureEnabled = await checkFeatureStatus();
        if (featureEnabled) {
          // Auto-advance to next step
          return { skip: true };
        }
      },
    },
  ],
};
```

### 4. **Internationalization (i18n)**

For multi-language support:

```typescript
// tours/i18n/tour-translations.ts
export const TOUR_TRANSLATIONS = {
  'es': {
    'pos-first-sale': {
      welcome: '¡Bienvenido a Vendix!',
      // ...
    },
  },
  'en': {
    'pos-first-sale': {
      welcome: 'Welcome to Vendix!',
      // ...
    },
  },
};
```

### 5. **Analytics Integration**

Track tour completion and engagement:

```typescript
// In tour-modal.component.ts
completeTour(): void {
  console.log('[TourModal] Tour completed');
  this.analyticsService.track('tour_completed', {
    tourId: this.tourConfig.id,
    duration: this.getTourDuration(),
    skippedSteps: this.getSkippedSteps(),
  });
  // ... rest of completion logic
}
```

## Performance Considerations

### 1. **Lazy Loading Tour Configs**

```typescript
// Instead of importing all tours at the top
const tours = {
  'pos-first-sale': () => import('./configs/pos-tour.config').then(m => m.POS_TOUR_CONFIG),
  'ecommerce': () => import('./configs/ecommerce-tour.config').then(m => m.ECOMMERCE_TOUR),
};

async function getTourConfig(id: string): Promise<TourConfig> {
  return tours[id]?.() || tours['pos-first-sale']();
}
```

### 2. **Observer Cleanup**

The current implementation already includes proper cleanup:
- `ResizeObserver.disconnect()`
- `MutationObserver.disconnect()`
- `clearTimeout` for scheduled recalculations
- Cleanup functions array in `ngOnDestroy`

### 3. **State Persistence**

Current implementation uses localStorage efficiently:
- Single key `'vendix_tours_state'`
- Stores only necessary data (completed/skipped tour IDs)
- O(1) lookup time for tour status

## Extensibility Points

### 1. **Custom Step Types**

```typescript
// Add interactive steps
{
  id: 'interactive-task',
  type: 'interactive', // New step type
  title: 'Practice Task',
  task: 'Create a test product',
  validate: async () => {
    // Custom validation logic
    return await checkTestProductExists();
  },
}
```

### 2. **Tour Dependencies**

```typescript
// Tours that require other tours to be completed first
export const ADVANCED_TOUR: TourConfig = {
  id: 'advanced-features',
  requiresTours: ['pos-first-sale', 'ecommerce-onboarding'],
  // ... steps
};
```

### 3. **Scheduled Tours**

```typescript
// Tours that appear at specific times
export const WEEKLY_REMINDER_TOUR: TourConfig = {
  id: 'weekly-reminder',
  schedule: {
    frequency: 'weekly',
    dayOfWeek: 1, // Monday
  },
};
```

## Memory & Storage Estimates

### Per Tour
- Config size: ~2-5 KB (JSON)
- State storage: ~100 bytes per completed tour (localStorage)

### Scalability Limits
- **Tours**: 100+ tours easily supported
- **Steps per tour**: 50+ steps with no performance impact
- **Concurrent users**: No server-side storage (client-side only)

## Recommended Next Steps

1. **Short Term** (Next Sprint):
   - Add ecommerce onboarding tour
   - Create tour for inventory management
   - Add A/B testing for tour effectiveness

2. **Medium Term** (Next Quarter):
   - Implement tour analytics dashboard
   - Add multi-language support
   - Create role-based tour routing

3. **Long Term** (Future):
   - AI-powered personalized tour paths
   - Community-contributed tour library
   - Tour template system for quick creation

## Conclusion

The current tour system architecture is **highly scalable** with:
- ✅ Modular configuration-based approach
- ✅ Reusable UI components
- ✅ Minimal memory footprint
- ✅ Fast localStorage-based state
- ✅ Clean separation of concerns
- ✅ Easy to add new tours without code changes to core components

**Estimated capacity**: 100+ tours, 1000+ steps across all tours, with negligible performance impact.
