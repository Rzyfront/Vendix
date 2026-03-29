---
name: vendix-frontend-icons
description: Protocol for using and registering system icons (Lucide) in the Frontend. Trigger: When adding icons to components, buttons, menus, or using <app-icon>.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [frontend]
  auto_invoke: "When adding icons to components, buttons, menus, or using <app-icon>"
---

> **Tip**: Antes de usar app-icon, consulta su README en `apps/frontend/src/app/shared/components/icon/README.md` para conocer como registrar iconos y los iconos disponibles.

## 🎨 Icon System Protocol

Vendix uses **Lucide Angular** icons, but they are **NOT** globally available. They must be explicitly registered in a central registry to optimize bundle size.

### 🚨 CRITICAL RULES

1.  **NEVER** assume an icon exists.
2.  **ALWAYS** check `apps/frontend/src/app/shared/components/icon/icons.registry.ts` first.
3.  **IF MISSING**: You MUST register it before using it.
4.  **IF EXISTS**: Use the exact key defined in the registry.

---

### 📖 How to Register a New Icon

**File:** `apps/frontend/src/app/shared/components/icon/icons.registry.ts`

1.  **Import** the icon from `lucide-angular`.
2.  **Add** it to the `ICON_REGISTRY` constant.
3.  **Use** the key (camelCase or kebab-case as defined in the registry).

#### Example

```typescript
// 1. Import
import {
  // ... existing imports
  Fingerprint, // <--- New Import
} from "lucide-angular";

export const ICON_REGISTRY: Record<string, LucideIconData> = {
  // ... existing icons

  // 2. Register
  fingerprint: Fingerprint, // <--- Add to registry
} as const;
```

---

### 💻 How to Use

Once registered, use the **key** string in your components.

#### In Templates (HTML)

```html
<!-- Basic Usage -->
<app-icon name="fingerprint" size="24" class="text-primary"></app-icon>

<!-- In Buttons -->
<app-button iconName="fingerprint">Authenticate</app-button>
```

#### In Typescript (Menu Items / Config)

```typescript
const menuItem = {
  label: "Biometrics",
  icon: "fingerprint", // Must match registry key
  route: "/settings/bio",
};
```

### 🔍 Troubleshooting

**Error:** `Icon "xyz" not found` or blank icon.
**Fix:** The icon is likely missing from `icons.registry.ts`. Add it immediately.
