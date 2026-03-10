# Vendix Store Settings

> **DEPRECATED**: This skill has been superseded by `vendix-settings-system` which provides a more complete guide for both `store_settings` and `organization_settings`.
>
> See: [vendix-settings-system](../vendix-settings-system/SKILL.md)

---

> **Store Settings Module** - Multi-section configuration system for stores with cross-domain synchronization.

## 🎯 When to Use

Use this skill when:
- Working on the store general settings module (`/admin/settings/general`)
- Creating or modifying configuration sections (general, inventory, notifications, pos, receipts, app, checkout, shipping)
- Modifying synchronization between `store_settings`, `stores`, and `store_settings.settings.branding` (source of truth)
- Implementing auto-save functionality with debounce
- Working with configuration templates (`default_templates`)

---

## 📊 Module Architecture

### Data Structure

The store settings module manages **8 sections**:

1. **General** - Basic configuration (timezone, currency, language, tax_included, name, logo_url, store_type)
2. **Inventory** - Stock control (low_stock_threshold, out_of_stock_action, track_inventory)
3. **Notifications** - Alerts (email_enabled, sms_enabled, low_stock_alerts, new_order_alerts)
4. **POS** - Point of Sale (allow_anonymous_sales, business_hours, offline_mode_enabled)
5. **Receipts** - Receipts (print_receipt, email_receipt, receipt_header, receipt_footer)
6. **App** - Visual branding (name, primary_color, secondary_color, accent_color, theme, logo_url, favicon_url)
7. **Checkout** - Payment flow (require_customer_data, allow_guest_checkout, allow_partial_payments)
8. **Shipping** - Shipping (enabled, free_shipping_threshold, shipping_zones, shipping_types)

### Database

#### Main Table: `store_settings`

```prisma
model store_settings {
  id         Int       @id @default(autoincrement())
  store_id   Int       @unique
  settings   Json?     // { general, inventory, checkout, shipping, notifications, pos, receipts, app }
  created_at DateTime? @default(now()) @db.Timestamp(6)
  updated_at DateTime? @default(now()) @db.Timestamp(6)
  stores     stores    @relation(fields: [store_id], references: [id])
}
```

#### Synchronization with other tables:

1. **`stores`** - Fields synchronized from `general`:
   - `name`, `logo_url`, `store_type`, `timezone`

2. **`domain_settings`** - Fields synchronized from `app`:
   - `config.branding.name`, `logo_url`, `favicon_url`, `primary_color`, `secondary_color`, `accent_color`, `theme`
   - **IMPORTANT**: Updates ALL domains for the store

3. **`organizations`** - Synchronized field:
   - `name` (synchronized with the store name)

---

## 🔧 Frontend Pattern: Auto-save with Feedback

### Service with BehaviorSubject

**File:** `apps/frontend/src/app/private/modules/store/settings/general/services/store-settings.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class StoreSettingsService {
  private http = inject(HttpClient);
  private readonly api_base_url = `${environment.apiUrl}/store`;

  // Subject for auto-save with debounce
  private save_settings$$ = new Subject<Partial<StoreSettings>>();

  // BehaviorSubject for global state
  private settings$$ = new BehaviorSubject<StoreSettings | null>(null);
  settings$ = this.settings$$.asObservable();

  /**
   * Saves settings with a 2.5s debounce
   * RETURNS Observable so the component can receive feedback
   */
  saveSettings(settings: Partial<StoreSettings>): Observable<ApiResponse<StoreSettings>> {
    return this.save_settings$$.pipe(
      debounceTime(2500),
      distinctUntilChanged(
        (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr),
      ),
      switchMap((s) => this.update_settings_api(s)),
    );
  }

  /**
   * Immediate save (no debounce)
   */
  saveSettingsNow(settings: Partial<StoreSettings>): Observable<ApiResponse<StoreSettings>> {
    return this.update_settings_api(settings);
  }

  private update_settings_api(settings: Partial<StoreSettings>): Observable<ApiResponse<StoreSettings>> {
    return this.http.patch<ApiResponse<StoreSettings>>(
      `${this.api_base_url}/settings`,
      settings,
    );
  }

  getSettings(): Observable<ApiResponse<StoreSettings>> {
    return this.http.get<ApiResponse<StoreSettings>>(
      `${this.api_base_url}/settings`,
    );
  }

  resetToDefault(): Observable<ApiResponse<StoreSettings>> {
    return this.http.post<ApiResponse<StoreSettings>>(
      `${this.api_base_url}/settings/reset`,
      {},
    );
  }
}
```

---

### Component with Feedback

**File:** `apps/frontend/src/app/private/modules/store/settings/general/general-settings.component.ts`

```typescript
import { Component, inject } from '@angular/core';
import { StoreSettingsService } from './services/store-settings.service';
import { ToastService } from '@shared/components/toast/toast.service';

@Component({
  selector: 'app-general-settings',
  standalone: true,
  templateUrl: './general-settings.component.html',
})
export class GeneralSettingsComponent {
  private settings_service = inject(StoreSettingsService);
  private toast_service = inject(ToastService);

  settings: StoreSettings = {} as StoreSettings;
  isLoading = true;
  isSaving = false;
  isAutoSaving = false;
  hasUnsavedChanges = false;
  lastSaved: Date | null = null;
  saveError: string | null = null;

  /**
   * Called when any section changes
   * Implements auto-save with user feedback
   */
  onSectionChange(section: keyof StoreSettings, new_settings: any) {
    this.settings = {
      ...this.settings,
      [section]: new_settings,
    };
    this.hasUnsavedChanges = true;
    this.lastSaved = null;
    this.saveError = null;
    this.isAutoSaving = true;

    // Subscribe to receive feedback from auto-save
    this.settings_service.saveSettings({ [section]: new_settings }).subscribe({
      next: (response) => {
        this.hasUnsavedChanges = false;
        this.lastSaved = new Date();
        this.isAutoSaving = false;
        this.toast_service.success('Changes saved automatically');
      },
      error: (error) => {
        this.hasUnsavedChanges = true;
        this.saveError = error.message || 'Error saving changes';
        this.isAutoSaving = false;
        this.toast_service.error('Error saving changes');
      }
    });
  }

  /**
   * Manual save (immediate, no debounce)
   */
  saveAllSettings() {
    this.isSaving = true;
    this.settings_service.saveSettingsNow(this.settings).subscribe({
      next: () => {
        this.isSaving = false;
        this.hasUnsavedChanges = false;
        this.lastSaved = new Date();
        this.toast_service.success('Settings saved');
      },
      error: (error) => {
        this.isSaving = false;
        console.error('Error saving settings:', error);
        this.toast_service.error('Error saving settings');
      },
    });
  }
}
```

---

## 🔧 Backend Pattern: Multi-Table Sync

### Service with RequestContext

**File:** `apps/backend/src/domains/store/settings/settings.service.ts`

```typescript
import { Injectable, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '@prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '@prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: StorePrismaService,
    private organizationPrisma: OrganizationPrismaService,
    private s3Service: S3Service,
  ) {}

  /**
   * Get settings with store data merged in
   * IMPORTANT: Merges data from stores table into general section
   */
  async getSettings(): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    // Get store data from stores table
    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        id: true,
        name: true,
        logo_url: true,
        store_type: true,
        timezone: true,
        organization_id: true,
      }
    });

    let storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });

    // Get domain config for app section
    const domainConfig = await this.getDomainConfig(store_id);
    const branding = domainConfig?.branding || {};

    if (!storeSettings || !storeSettings.settings) {
      return {
        ...getDefaultStoreSettings(),
        general: {
          ...getDefaultStoreSettings().general,
          name: store?.name,              // From stores table
          logo_url: store?.logo_url,      // From stores table
          store_type: store?.store_type,  // From stores table
          timezone: store?.timezone || getDefaultStoreSettings().general.timezone,
        },
        app: {
          name: branding.name || store?.name || 'Vendix',
          primary_color: branding.primary_color || '#7ED7A5',
          secondary_color: branding.secondary_color || '#2F6F4E',
          // ... other branding fields
        }
      };
    }

    // Merge existing settings with store data
    const settings = storeSettings.settings as StoreSettings;
    return {
      ...settings,
      general: {
        ...settings.general,
        name: store?.name,              // Override with stores table
        logo_url: store?.logo_url,
        store_type: store?.store_type,
        timezone: store?.timezone || settings.general.timezone,
      },
      app: {
        name: branding.name || store?.name || 'Vendix',
        primary_color: branding.primary_color || '#7ED7A5',
        // ... other branding fields
      }
    };
  }

  /**
   * Update settings with cross-table synchronization
   * IMPORTANT: Syncs to stores, domain_settings, and organizations tables
   */
  async updateSettings(dto: UpdateSettingsDto): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    const currentSettings = await this.getSettings();

    // Handle app section separately (domain_settings)
    if (dto.app) {
      await this.updateDomainBranding(store_id, dto.app);
      delete (dto as any).app; // Remove from dto to not save in store_settings
    }

    // Handle general section - sync to stores table
    if (dto.general) {
      const { name, logo_url, store_type, timezone } = dto.general;

      const storeUpdateData: any = {};
      if (name !== undefined) storeUpdateData.name = name;
      if (logo_url !== undefined) storeUpdateData.logo_url = logo_url;
      if (store_type !== undefined) storeUpdateData.store_type = store_type;
      if (timezone !== undefined) storeUpdateData.timezone = timezone;

      if (Object.keys(storeUpdateData).length > 0) {
        await this.prisma.stores.update({
          where: { id: store_id },
          data: storeUpdateData,
        });

        // Sync name to all domains
        if (name) {
          await this.updateDomainBranding(store_id, { name } as any);
        }

        // Trigger favicon generation if logo changed
        if (logo_url !== undefined && logo_url !== null) {
          this.generateFaviconForStore(store_id, logo_url)
            .catch(error => this.logger.warn(`Favicon generation failed: ${error.message}`));
        }
      }
    }

    // Merge and save to store_settings
    const updatedSettings = { ...currentSettings };
    for (const key of Object.keys(dto)) {
      if (dto[key as keyof UpdateSettingsDto] !== undefined) {
        (updatedSettings as any)[key] = dto[key as keyof UpdateSettingsDto];
      }
    }

    return this.prisma.store_settings.upsert({
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
  }

  /**
   * Update branding in ALL domains for the store
   * IMPORTANT: Updates every domain associated with the store
   */
  private async updateDomainBranding(storeId: number, appSettings: AppSettingsDto): Promise<void> {
    const domains = await this.organizationPrisma.domain_settings.findMany({
      where: { store_id: storeId }
    });

    if (domains.length === 0) {
      this.logger.warn(`No domains found for store ${storeId}, skipping branding update`);
      return;
    }

    // Update each domain individually to preserve unique configs
    const updatePromises = domains.map(async (domain) => {
      const existingConfig = (domain.config as any) || {};
      const existingBranding = existingConfig.branding || {};

      const updatedConfig = {
        ...existingConfig,
        branding: {
          ...existingBranding,
          ...(appSettings.name !== undefined && { name: appSettings.name }),
          ...(appSettings.primary_color !== undefined && { primary_color: appSettings.primary_color }),
          ...(appSettings.secondary_color !== undefined && { secondary_color: appSettings.secondary_color }),
          ...(appSettings.accent_color !== undefined && { accent_color: appSettings.accent_color }),
          ...(appSettings.theme !== undefined && { theme: appSettings.theme }),
          ...(appSettings.logo_url !== undefined && { logo_url: appSettings.logo_url }),
          ...(appSettings.favicon_url !== undefined && { favicon_url: appSettings.favicon_url }),
        }
      };

      return this.organizationPrisma.domain_settings.update({
        where: { id: domain.id },
        data: { config: updatedConfig }
      });
    });

    await Promise.all(updatePromises);
  }
}
```

---

## 📋 Validation DTOs

### Main UpdateSettingsDto

**File:** `apps/backend/src/domains/store/settings/dto/update-settings.dto.ts`

```typescript
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GeneralSettingsDto } from './settings-schemas.dto';
import { AppSettingsDto } from './settings-schemas.dto';
// ... other section DTOs

export class UpdateSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => GeneralSettingsDto)
  general?: GeneralSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AppSettingsDto)
  app?: AppSettingsDto;

  // ... other sections
}
```

### Section DTO Example

```typescript
import { IsString, IsBoolean, IsOptional, IsEnum, Matches } from 'class-validator';

export class GeneralSettingsDto {
  @IsString()
  timezone: string;

  @IsString()
  currency: string;

  @IsString()
  language: string;

  @IsBoolean()
  tax_included: boolean;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  logo_url?: string;

  @IsOptional()
  @IsEnum(['physical', 'online', 'hybrid', 'popup', 'kiosko'])
  store_type?: 'physical' | 'online' | 'hybrid' | 'popup' | 'kiosko';
}

export class AppSettingsDto {
  @IsString()
  name: string;

  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primary_color must be a valid hex color' })
  primary_color: string;

  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'secondary_color must be a valid hex color' })
  secondary_color: string;

  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'accent_color must be a valid hex color' })
  accent_color: string;

  @IsIn(['default', 'aura', 'monocromo'], { message: 'theme must be either "default", "aura", or "monocromo"' })
  theme: 'default' | 'aura' | 'monocromo';

  @IsOptional()
  @IsString()
  logo_url?: string;

  @IsOptional()
  @IsString()
  favicon_url?: string;
}
```

---

## 🎯 Decision Tree

```
Working on store settings?
├── Frontend
│   ├── Use BehaviorSubject for global state
│   ├── Implement debounce (2500ms) for auto-save
│   ├── Return Observable for user feedback
│   └── Show confirmation with ToastService
│
└── Backend
    ├── Use RequestContextService for store_id
    ├── Get data from stores table for general section
    ├── Sync app section with domain_settings (ALL domains)
    ├── Sync general section with stores table
    ├── Sync name with organizations table
    └── Generate favicon if logo changed
```

---

## 🔍 Key Files

| File | Purpose |
|------|---------|
| `apps/frontend/src/app/private/modules/store/settings/general/general-settings.component.ts` | Main component |
| `apps/frontend/src/app/private/modules/store/settings/general/services/store-settings.service.ts` | Service with BehaviorSubject |
| `apps/backend/src/domains/store/settings/settings.service.ts` | Backend service |
| `apps/backend/src/domains/store/settings/settings.controller.ts` | API controller |
| `apps/backend/src/domains/store/settings/dto/update-settings.dto.ts` | Validation DTOs |

---

## ⚠️ Common Mistakes

### ❌ Error: Auto-save without feedback

```typescript
// BAD: Fire-and-forget
onSectionChange(section: string, settings: any) {
  this.settings_service.saveSettings({ [section]: settings });
  // ❌ No user feedback
}
```

```typescript
// ✅ GOOD: With feedback
onSectionChange(section: string, settings: any) {
  this.settings_service.saveSettings({ [section]: settings }).subscribe({
    next: () => this.toast_service.success('Saved'),
    error: () => this.toast_service.error('Error')
  });
}
```

### ❌ Error: `name` field not loading

```typescript
// BAD: Only using store_settings.settings
const settings = storeSettings.settings as StoreSettings;
return settings; // ❌ name is not here
```

```typescript
// ✅ GOOD: Merge with stores table
const store = await this.prisma.stores.findUnique({ where: { id: store_id } });
return {
  ...settings,
  general: {
    ...settings.general,
    name: store?.name, // ✅ From stores table
  }
};
```

---

## 🚀 Useful Commands

```bash
# Check frontend logs
docker logs --tail 40 vendix_frontend

# Check backend logs
docker logs --tail 40 vendix_backend

# Search for errors
docker logs --tail 40 vendix_frontend | grep -i "error"
docker logs --tail 40 vendix_backend | grep -i "error"
```

---

## 📚 Related Skills

- `vendix-frontend-state` - BehaviorSubject + ToastService pattern
- `vendix-backend-domain` - Hexagonal architecture
- `vendix-prisma-scopes` - Prisma scoping system and model registration
- `vendix-multi-tenant-context` - RequestContextService
- `buildcheck-dev` - MANDATORY build verification
- `vendix-validation` - Validation with class-validator
