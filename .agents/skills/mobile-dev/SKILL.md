---
name: mobile-dev
description: >
  Mobile app development rules for Vendix Expo/React Native project.
  Trigger: When editing, creating, or modifying any file under apps/mobile, or when developing mobile-specific features.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Editing or creating any file under apps/mobile"
    - "Developing features for the mobile app"
    - "Adding dependencies to apps/mobile/package.json"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Mobile Dev

## Purpose

This skill governs all development within the mobile app (`apps/mobile`). Its primary purpose is to enforce strict boundaries: **never edit files outside `apps/mobile`**, even when referencing patterns from other projects for alignment.

The mobile app is an Expo/React Native project. It can reference frontend (`apps/frontend`) components/styles for UI alignment and backend (`apps/backend`) DTOs/interfaces for API contract alignment, but must **never modify** those files.

## Core Rules

### RULE 1: Exclusive Mobile Scope (BLOCKING)

**ALL** edits, creations, and modifications are **exclusively** within `apps/mobile/`.

```
ALLOWED:
  apps/mobile/src/...
  apps/mobile/app/...
  apps/mobile/assets/...
  apps/mobile/package.json
  apps/mobile/tsconfig.json
  apps/mobile/*.config.js

FORBIDDEN:
  apps/backend/src/...          ← Read only
  apps/frontend/src/...         ← Read only
  libs/shared-types/src/...     ← Read only
  Any file outside apps/mobile/
```

### RULE 2: Read-Only Access to Other Projects

The mobile project **may read** files from other projects for reference:

| Source | Purpose | Allowed |
|--------|---------|---------|
| `apps/frontend/src/...` | UI patterns, component structure, styling conventions | ✅ Read only |
| `apps/backend/src/...` | DTOs, API contracts, TypeScript interfaces | ✅ Read only |
| `libs/shared-types/...` | Shared enums, types, constants | ✅ Read only |
| `apps/backend/prisma/...` | Data models for understanding API entities | ✅ Read only |
| Any file outside `apps/mobile/` | Reference only | ✅ Read only |

**NEVER** edit, modify, or write to any file outside `apps/mobile/`.

### RULE 3: Dependency Isolation

All mobile-specific dependencies must be declared in `apps/mobile/package.json` only.

```
ALLOWED:
  npm install <pkg> --prefix apps/mobile
  # or edit apps/mobile/package.json directly

FORBIDDEN:
  npm install <pkg> at root         ← Breaks monorepo isolation
  Editing root package.json         ← Belongs to vendix-monorepo-workspaces
  Adding deps to apps/frontend/     ← Not mobile's concern
  Adding deps to apps/backend/      ← Not mobile's concern
```

### RULE 4: Interface Alignment Without Modification

When aligning mobile interfaces with backend DTOs or frontend patterns:

1. Read the backend DTO from `apps/backend/...` to understand the API contract.
2. Create an equivalent TypeScript interface **inside** `apps/mobile/src/...`.
3. Transform/adapt the data as needed for React Native.
4. **Never** import directly from backend source files (no cross-app runtime imports).

```
CORRECT (read backend, create mobile version):
  // Read: apps/backend/src/domains/product/dto/product.dto.ts
  // Create: apps/mobile/src/app/products/interfaces/product.interface.ts
  export interface Product {
    id: string;
    name: string;
    price: number;
  }

FORBIDDEN (direct import from backend):
  import { ProductDto } from '../../../../backend/...';  // ✗ NO
```

### RULE 5: No Shared Project Edits

Do not modify `libs/shared-types/` or any shared library as part of mobile development. If a type needs to be shared, it must be defined independently in `apps/mobile/src/` or requested as a separate cross-project change.

### RULE 6: API Consumption Pattern

Mobile app consumes the same backend API as the frontend. When implementing API calls:

1. Read the backend endpoint and DTO to understand request/response shapes.
2. Create mobile service functions that call the API and transform responses.
3. Do not copy backend validation or business logic — keep it in the backend.

## Related Skills

- `vendix-core` - Repository architecture and app boundary understanding
- `vendix-monorepo-workspaces` - Monorepo dependency and package management
- `vendix-backend-api` - Understanding backend API endpoint patterns
- `vendix-frontend-component` - Reference for UI component patterns
