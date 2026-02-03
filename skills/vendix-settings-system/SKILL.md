---
name: vendix-settings-system
description: >
  Complete guide for store_settings and organization_settings configuration system.
  Trigger: When working with settings configuration, adding new settings sections, or understanding how settings flow works.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: backend, frontend
  auto_invoke:
    - Adding new settings sections to stores or organizations
    - Modifying store_settings or organization_settings
    - Working with default_templates
    - Understanding settings inheritance and defaults
---

## When to Use

- Adding a new configuration section to `store_settings` or `organization_settings`
- Understanding how settings are created, read, and updated
- Working with `default_templates` system
- Debugging settings synchronization issues
- Implementing settings in frontend components

---

## Architecture Overview

### Settings Tables

```
organizations (1)
    └── organization_settings (0..1)
        └── settings (JSON)
            ├── branding (colors, logo, fonts)
            ├── fonts (typography)
            └── panel_ui (module visibility for ORG_ADMIN)

stores (1)
    └── store_settings (0..1)
        └── settings (JSON)
            ├── branding     ← SOURCE OF TRUTH for colors/logo
            ├── fonts
            ├── publication
            ├── general
            ├── inventory
            ├── checkout
            ├── notifications
            ├── pos
            ├── receipts
            ├── panel_ui
            ├── ecommerce    ← Has own branding (independent)
            └── app          ← LEGACY (redundant with branding)
```

### Key Relationships

| Table | Relationship | Description |
|-------|--------------|-------------|
| `store_settings` | 1-to-1 with `stores` | `store_id` UNIQUE constraint |
| `organization_settings` | 1-to-1 with `organizations` | `organization_id` UNIQUE constraint |
| `default_templates` | System-wide | Reusable templates, manually applied |

---

## Source of Truth Pattern

### Store Branding
```
store_settings.settings.branding  ← SOURCE OF TRUTH
    │
    ├──(sync)→ stores.name
    ├──(sync)→ stores.logo_url
    └──(sync)→ organizations.name
```

### Organization Branding
```
organization_settings.settings.branding  ← SOURCE OF TRUTH
    │
    └── (no sync - independent)
```

**CRITICAL**: Never store branding in `domain_settings.config`. Always read from `store_settings.settings.branding` or `organization_settings.settings.branding`.

---

## Default Values Pattern

### Dual Defaults System

The system uses TWO default sources:

1. **Hardcoded Defaults** (Primary)
   - Location: `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`
   - Function: `getDefaultStoreSettings()`
   - Used: Automatically during store creation and when settings don't exist

2. **Database Templates** (Secondary)
   - Table: `default_templates`
   - Used: Manually via `applyTemplate()` method
   - Purpose: Centralized configuration for administrators

### When Each Is Used

```
Store Creation
    │
    ├── settings provided? → Use provided settings
    └── no settings? → Use getDefaultStoreSettings()

Template Application (manual)
    │
    └── User clicks "Apply Template" → Overwrite with template_data
```

---

## Adding a New Settings Section

### Step 1: Update Interface

**File:** `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`

```typescript
// 1. Create the section interface
export interface MyNewSettings {
  enabled: boolean;
  option_a: string;
  option_b: number;
}

// 2. Add to main StoreSettings interface
export interface StoreSettings {
  // ... existing sections
  my_new_section?: MyNewSettings;  // ← Optional for backwards compatibility
}
```

### Step 2: Add Defaults

**File:** `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`

```typescript
export function getDefaultStoreSettings(): StoreSettings {
  return {
    // ... existing defaults

    // NEW SECTION
    my_new_section: {
      enabled: false,
      option_a: 'default_value',
      option_b: 10,
    },
  };
}
```

### Step 3: Create DTO

**File:** `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts`

```typescript
import { IsBoolean, IsString, IsNumber, IsOptional } from 'class-validator';

export class MyNewSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  option_a?: string;

  @IsOptional()
  @IsNumber()
  option_b?: number;
}
```

### Step 4: Add to Update DTO

**File:** `apps/backend/src/domains/store/settings/dto/update-settings.dto.ts`

```typescript
import { MyNewSettingsDto } from './settings-schemas.dto';

export class UpdateSettingsDto {
  // ... existing sections

  @IsOptional()
  @ValidateNested()
  @Type(() => MyNewSettingsDto)
  my_new_section?: MyNewSettingsDto;
}
```

### Step 5: Update Template (Optional)

**File:** `apps/backend/prisma/seeds/default-templates.seed.ts`

```typescript
{
  template_name: 'store_default_settings',
  configuration_type: 'store_settings',
  template_data: {
    // ... existing sections

    my_new_section: {
      enabled: false,
      option_a: 'template_value',
      option_b: 15,
    },
  },
}
```

---

## Backend Service Patterns

### Reading Settings (with defaults)

```typescript
async getSettings(): Promise<StoreSettings> {
  const context = RequestContextService.getContext();
  const store_id = context?.store_id;

  if (!store_id) {
    throw new ForbiddenException('Store context required');
  }

  const storeSettings = await this.prisma.store_settings.findUnique({
    where: { store_id },
  });

  if (!storeSettings || !storeSettings.settings) {
    return getDefaultStoreSettings();  // ← Fallback to defaults
  }

  const settings = storeSettings.settings as StoreSettings;
  return {
    ...getDefaultStoreSettings(),  // ← Defaults first
    ...settings,                    // ← Override with actual values
  };
}
```

### Updating Settings (upsert pattern)

```typescript
async updateSettings(dto: UpdateSettingsDto): Promise<StoreSettings> {
  const context = RequestContextService.getContext();
  const store_id = context?.store_id;

  if (!store_id) {
    throw new ForbiddenException('Store context required');
  }

  const currentSettings = await this.getSettings();

  // Merge only provided sections
  const updatedSettings = { ...currentSettings };
  for (const key of Object.keys(dto)) {
    if (dto[key] !== undefined) {
      updatedSettings[key] = dto[key];
    }
  }

  // UPSERT: create if not exists, update otherwise
  const result = await this.prisma.store_settings.upsert({
    where: { store_id },
    update: {
      settings: updatedSettings,
      updated_at: new Date(),
    },
    create: {
      store_id,
      settings: updatedSettings,
    },
  });

  return result.settings as StoreSettings;
}
```

### Cross-Table Synchronization

When updating certain fields, sync to other tables:

```typescript
// Sync to stores table
if (dto.app?.name !== undefined) {
  await this.prisma.stores.update({
    where: { id: store_id },
    data: { name: dto.app.name },
  });
}

// Sync to organizations table
if (dto.app?.name !== undefined) {
  const store = await this.prisma.stores.findUnique({
    where: { id: store_id },
    select: { organization_id: true }
  });

  if (store?.organization_id) {
    await this.organizationPrisma.organizations.update({
      where: { id: store.organization_id },
      data: { name: dto.app.name }
    });
  }
}
```

---

## Frontend Integration

### Service Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class StoreSettingsService {
  private http = inject(HttpClient);
  private save$$ = new Subject<Partial<StoreSettings>>();

  // Auto-save with 2.5s debounce
  saveSettings(settings: Partial<StoreSettings>): Observable<StoreSettings> {
    return this.save$$.pipe(
      debounceTime(2500),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      switchMap(s => this.http.patch<StoreSettings>('/store/settings', s)),
    );
  }

  // Immediate save (no debounce)
  saveSettingsNow(settings: Partial<StoreSettings>): Observable<StoreSettings> {
    return this.http.patch<StoreSettings>('/store/settings', settings);
  }

  getSettings(): Observable<StoreSettings> {
    return this.http.get<StoreSettings>('/store/settings');
  }

  resetToDefault(): Observable<StoreSettings> {
    return this.http.post<StoreSettings>('/store/settings/reset', {});
  }
}
```

### Component Pattern

```typescript
onSectionChange(section: keyof StoreSettings, newSettings: any) {
  this.hasUnsavedChanges = true;
  this.isAutoSaving = true;

  this.settingsService.saveSettings({ [section]: newSettings }).subscribe({
    next: () => {
      this.hasUnsavedChanges = false;
      this.isAutoSaving = false;
      this.toastService.success('Guardado automáticamente');
    },
    error: (err) => {
      this.isAutoSaving = false;
      this.toastService.error('Error al guardar');
    }
  });
}
```

---

## API Endpoints

### Store Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/store/settings` | Get current store settings |
| PATCH | `/store/settings` | Update settings (partial) |
| POST | `/store/settings/reset` | Reset to defaults |
| GET | `/store/settings/templates` | Get system templates |
| POST | `/store/settings/apply-template` | Apply a template |

### Organization Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/organization/settings` | Get organization settings |
| PUT | `/organization/settings` | Update settings (full) |
| GET | `/organization/settings/branding` | Get branding only |
| PUT | `/organization/settings/branding` | Update branding only |

---

## S3 URL Handling

**CRITICAL**: Never store signed URLs. Always extract S3 keys.

```typescript
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';

// BEFORE storing
if (dto.app.logo_url !== undefined) {
  dto.app.logo_url = extractS3KeyFromUrl(dto.app.logo_url) ?? undefined;
}

// WHEN reading (in public-domains.service.ts)
if (branding.logo_url && !branding.logo_url.startsWith('http')) {
  branding.logo_url = await this.s3Service.getSignedUrl(branding.logo_url);
}
```

---

## Prisma Schema Reference

```prisma
model store_settings {
  id         Int       @id @default(autoincrement())
  store_id   Int       @unique
  settings   Json?
  created_at DateTime? @default(now()) @db.Timestamp(6)
  updated_at DateTime? @default(now()) @db.Timestamp(6)
  stores     stores    @relation(fields: [store_id], references: [id], onUpdate: NoAction)
}

model organization_settings {
  id              Int           @id @default(autoincrement())
  organization_id Int           @unique
  settings        Json?
  created_at      DateTime?     @default(now()) @db.Timestamp(6)
  updated_at      DateTime?     @default(now()) @db.Timestamp(6)
  organization    organizations @relation(fields: [organization_id], references: [id], onDelete: Cascade)
}

model default_templates {
  id                 Int                       @id @default(autoincrement())
  template_name      String                    @unique @db.VarChar(255)
  configuration_type template_config_type_enum
  template_data      Json
  description        String?                   @db.Text
  is_active          Boolean                   @default(true)
  is_system          Boolean                   @default(false)
  created_at         DateTime?                 @default(now()) @db.Timestamp(6)
  updated_at         DateTime?                 @default(now()) @db.Timestamp(6)
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` | StoreSettings type definition |
| `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts` | Hardcoded defaults |
| `apps/backend/src/domains/store/settings/settings.service.ts` | Main store settings service |
| `apps/backend/src/domains/organization/settings/settings.service.ts` | Organization settings service |
| `apps/backend/prisma/seeds/default-templates.seed.ts` | Database templates |
| `apps/frontend/src/app/private/modules/store/settings/general/services/store-settings.service.ts` | Frontend service |

---

## Related Skills

- `vendix-prisma-schema` - Prisma schema editing
- `vendix-backend-prisma` - PrismaService patterns
- `vendix-multi-tenant-context` - RequestContextService
- `vendix-s3-storage` - S3 URL handling
- `vendix-validation` - DTO validation patterns
