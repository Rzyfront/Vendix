---
name: vendix-frontend-theme
description: Theme and branding patterns.
metadata:
  scope: [root]
  auto_invoke: "Styling and Theming"
---
# Vendix Frontend Theme & Branding

> **ThemeService, Branding Configuration & Visual Styling** - Theme management, branding, and CSS variables for multi-tenancy.

## 🎯 Theme Management

**Vendix uses a centralized branding system:**
- **ThemeService** - Transforms and applies visual configuration
- **CSS Variables** - Dynamically applied per domain
- **BrandingGeneratorHelper** (Backend) - Generates standard branding
- **snake_case → camelCase format** - Automatic transformation

---

## 📋 Standard Branding Format

### Backend (snake_case)

```typescript
// Returned by /public/domains/resolve/:hostname
{
  name: "My Store",
  theme: "light",
  logo_url: "https://...",
  favicon_url: "https://...",
  primary_color: "#7ED7A5",
  secondary_color: "#2F6F4E",
  accent_color: "#FFFFFF",
  background_color: "#F4F4F4",
  surface_color: "#FFFFFF",
  text_color: "#222222",
  border_color: "#E5E7EB",
  text_secondary_color: "#555555",
  text_muted_color: "#AAAAAA"
}
```

### Frontend (camelCase)

```typescript
// BrandingConfig - used internally
{
  colors: {
    primary: "#7ED7A5",
    secondary: "#2F6F4E",
    accent: "#FFFFFF",
    background: "#F4F4F4",
    surface: "#FFFFFF",
    text: {
      primary: "#222222",
      secondary: "#555555",
      muted: "#AAAAAA"
    }
  },
  fonts: {
    primary: "Inter, sans-serif",
    secondary: string,
    headings: string
  },
  logo: {
    url: "https://...",
    alt: "My Store"
  },
  favicon: "https://...",
  customCSS: string
}
```

---

## 🎨 ThemeService

### Location
`apps/frontend/src/app/core/services/theme.service.ts`

### Core Methods

```typescript
import { Injectable } from '@angular/core';
import { BrandingConfig } from '../models/tenant-config.interface';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  // Applies full branding configuration
  async applyAppConfiguration(appConfig: AppConfig): Promise<void>

  // Applies branding only
  async applyBranding(brandingConfig: BrandingConfig): Promise<void>

  // Transforms backend → frontend format (CRITICAL)
  transformBrandingFromApi(apiBranding: any): BrandingConfig

  // Loads external fonts
  async loadFont(fontFamily: string): Promise<void>

  // Injects custom CSS
  injectCustomCSS(css: string, id: string): void

  // Updates favicon
  updateFavicon(faviconUrl: string): void

  // Resets everything to default
  resetTheme(): void
}
```

### Applied CSS Variables

```css
:root {
  /* Colors */
  --color-primary: #7ED7A5;
  --color-secondary: #2F6F4E;
  --color-accent: #FFFFFF;
  --color-background: #F4F4F4;
  --color-surface: #FFFFFF;
  --color-text-primary: #222222;
  --color-text-secondary: #555555;
  --color-text-muted: #AAAAAA;

  /* Fonts */
  --font-primary: "Inter, sans-serif";
  --font-secondary: string;
  --font-headings: string;
}
```

---

## 🔄 Branding Flow

```
1. Backend: BrandingGeneratorHelper.generateBranding()
   → Generates config in snake_case

2. Domain Settings (DB)
   → Stores config.branding

3. API: /public/domains/resolve/:hostname
   → Returns domain_resolution with config

4. AppConfigService.setupConfig()
   → Retrieves domain_config

5. ThemeService.transformBrandingFromApi()
   → Transforms snake_case → camelCase

6. ThemeService.applyBranding()
   → Applies CSS variables to :root

7. Components
   → Use var(--color-primary)
```

---

## 💡 Usage in Components

### ✅ CORRECT - Using CSS Variables

```scss
// component.scss
.my-button {
  background-color: var(--color-primary, #7ED7A5);
  color: var(--color-text-primary, #222222);
  border: 1px solid var(--color-border, #E5E7EB);
}

.my-card {
  background: var(--color-surface, #FFFFFF);
  border-radius: var(--border-radius, 8px);
}
```

### ❌ WRONG - Hardcoded colors

```scss
// DO NOT do this
.my-button {
  background-color: #7ED7A5;  // ❌ Hardcoded
  color: #222222;              // ❌ Not dynamic
}
```

---

## 🔧 Integration with AppConfigService

### In app-config.service.ts

```typescript
import { ThemeService } from './theme.service';

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private http = inject(HttpClient);
  private themeService = inject(ThemeService);

  private buildAppConfig(domainConfig: DomainConfig): AppConfig {
    return {
      environment: domainConfig.environment,
      domainConfig,
      routes: this.resolveRoutes(domainConfig),
      layouts: [],
      // ✅ Uses ThemeService for transformation
      branding: this.themeService.transformBrandingFromApi(
        domainConfig.customConfig?.branding || {}
      ),
    };
  }
}
```

### In config.effects.ts

```typescript
import { ThemeService } from '../../services/theme.service';

@Injectable()
export class ConfigEffects {
  private themeService = inject(ThemeService);

  initializeAppSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ConfigActions.initializeAppSuccess),
        tap(({ config }) => {
          // ✅ Applies branding when config loads
          this.themeService.applyAppConfiguration(config);
        }),
      ),
    { dispatch: false },
  );
}
```

---

## 🎯 Backend: BrandingGeneratorHelper

### Location
`apps/backend/src/common/helpers/branding-generator.helper.ts`

### Usage in Services

```typescript
import { BrandingGeneratorHelper } from '@common/helpers/branding-generator.helper';

@Injectable()
export class OnboardingWizardService {
  private brandingGeneratorHelper = inject(BrandingGeneratorHelper);

  async setupAppConfig(dto: SetupAppConfigDto) {
    // ✅ Generates standard branding
    const branding = this.brandingGeneratorHelper.generateBranding({
      name: 'My Store',
      primaryColor: '#7ED7A5',
      secondaryColor: '#2F6F4E',
      theme: 'light',
    });

    // Saves to DB in snake_case format
    await this.prisma.domain_settings.create({
      data: {
        hostname: 'mystore-org.vendix.com',
        config: {
          app: 'ORG_LANDING',
          branding: branding, // ✅ Standard format
        },
      },
    });
  }
}
```

---

## 🚨 Critical Rules

### ✅ ALWAYS DO

1. **Use ThemeService.transformBrandingFromApi()** - Single source of truth
2. **Use CSS variables in components** - With fallback values
3. **Use BrandingGeneratorHelper in backend** - To generate branding
4. **Provide fallbacks** - `var(--color-primary, #7ED7A5)`
5. **Format colors as hex** - `#RRGGBB` or `#RGB`

### ❌ NEVER DO

1. **DO NOT duplicate transformation logic** - Use ThemeService
2. **DO NOT hardcode colors** - Use var(--color-*)
3. **DO NOT create custom formats** - Use the standard
4. **DO NOT omit fallbacks** - Always provide a default value
5. **DO NOT transform manually** - Let ThemeService handle it

---

## 🔍 Key Files

| File | Purpose |
|------|---------|
| `core/services/theme.service.ts` | Theme service |
| `core/services/app-config.service.ts` | App configuration |
| `core/store/config/config.effects.ts` | Applies branding |
| `core/models/tenant-config.interface.ts` | BrandingConfig |
| Backend: `common/helpers/branding-generator.helper.ts` | Generates branding |

---

## 🧪 Testing

### Verify CSS Variables

```typescript
// In browser console
getComputedStyle(document.documentElement)
  .getPropertyValue('--color-primary')
// → "#7ED7A5"
```

### Verify Transformation

```typescript
// theme.service.ts
const apiBranding = {
  primary_color: "#7ED7A5",
  secondary_color: "#2F6F4E",
};

const transformed = this.transformBrandingFromApi(apiBranding);

console.log(transformed.colors.primary);
// → "#7ED7A5" ✅
```

---

## 📚 Related Skills

- `vendix-frontend-domain` - Domain resolution and config
- `vendix-frontend-state` - State management
- `vendix-frontend-component` - Component structure
- `vendix-naming-conventions` - Naming conventions (CRITICAL)
