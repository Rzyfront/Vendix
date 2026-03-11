---
name: vendix-frontend-module
description: Angular module patterns.
metadata:
  scope: [root]
  auto_invoke: "Creating Frontend Modules"
---
# Vendix Frontend Module Pattern

> **Standard Module Pattern** - Standard structure for creating Angular modules with all necessary components.

## 🚨 CRITICAL RULE - Components MUST Be in Folders

**EVERY component in the module MUST be in its own folder, ALWAYS, NO EXCEPTIONS:**

```
❌ WRONG - Single file component:
components/
├── user-stats.component.ts           # ❌ WRONG
├── user-create-modal.component.ts    # ❌ WRONG
└── user-edit-modal.component.ts      # ❌ WRONG

✅ CORRECT - Each component in folder:
components/
├── user-stats/                       # ✅ CORRECT
│   ├── user-stats.component.ts
│   ├── user-stats.component.html
│   └── user-stats.component.scss
├── user-create-modal/                # ✅ CORRECT
│   ├── user-create-modal.component.ts
│   ├── user-create-modal.component.html
│   └── user-create-modal.component.scss
└── user-edit-modal/                  # ✅ CORRECT
    ├── user-edit-modal.component.ts
    ├── user-edit-modal.component.html
    └── user-edit-modal.component.scss
```

**This applies to:**
- ✅ Standalone components
- ✅ Modular components (with NgModule)
- ✅ Small components
- ✅ Large components
- ✅ ALL components without exception

**See `vendix-frontend-component` skill for detailed component patterns.**

---
metadata:
  scope: [root]
  auto_invoke: "Creating Frontend Modules"

## 📁 Standard Module Structure

```
apps/frontend/src/app/private/modules/{module-name}/
├── {module-name}.component.ts           # Main component
├── {module-name}.component.html         # Main template
├── {module-name}.component.scss         # Main styles
├── {module-name}.routes.ts              # Route definition (optional)
├── index.ts                              # Public module exports
├── components/                           # Module-specific components
│   ├── index.ts                          # Component exports
│   ├── {module}-stats.component.ts      # Statistics component
│   ├── {module}-stats.component.html
│   ├── {module}-stats.component.scss
│   ├── {module}-create-modal.component.ts
│   ├── {module}-create-modal.component.html
│   ├── {module}-create-modal.component.scss
│   ├── {module}-edit-modal.component.ts
│   ├── {module}-edit-modal.component.html
│   ├── {module}-edit-modal.component.scss
│   ├── {module}-empty-state.component.ts
│   ├── {module}-empty-state.component.html
│   ├── {module}-empty-state.component.scss
│   └── {module}-pagination.component.ts
│       ├── {module}-pagination.component.html
│       └── {module}-pagination.component.scss
├── services/                             # Business logic and API
│   └── {module}.service.ts
└── interfaces/                           # Types and data contracts
    └── {module}.interface.ts
```

---

## 🎯 Main Component

**File:** `{module-name}/{module-name}.component.ts`

```typescript
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { {Module}Service } from './services/{module}.service';
import { {Entity} } from './interfaces/{module}.interface';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-{module}',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './{module-name}.component.html',
  styleUrls: ['./{module-name}.component.scss'],
})
export class {Module}Component implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private {module}_service = inject({Module}Service);

  // State
  entities: {Entity}[] = [];
  isLoading = false;
  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    total_pages: 0,
  };

  ngOnInit() {
    this.loadEntities();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadEntities() {
    this.isLoading = true;
    this.{module}_service
      .getEntities({
        page: this.pagination.page,
        limit: this.pagination.limit,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.entities = response.data;
          this.pagination = response.meta.pagination;
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading entities:', error);
          this.isLoading = false;
        },
      });
  }

  onPageChange(page: number) {
    this.pagination.page = page;
    this.loadEntities();
  }

  onCreate() {
    // Open create modal
  }

  onEdit(entity: {Entity}) {
    // Open edit modal
  }

  onDelete(entity: {Entity}) {
    // Handle delete
  }
}
```

---

## 📊 Statistics Component

**File:** `components/{module}-stats/{module}-stats.component.ts`

```typescript
import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { {Module}Service } from '../../services/{module}.service';

@Component({
  selector: 'app-{module}-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './{module}-stats.component.html',
  styleUrls: ['./{module}-stats.component.scss'],
})
export class {Module}StatsComponent {
  private {module}_service = inject({Module}Service);

  stats = this.{module}_service.getStats();
}
```

**Template:** `components/{module}-stats/{module}-stats.component.html`

```html
<div class="stats-grid">
  <div class="stat-card">
    <h3>Total</h3>
    <p class="stat-value">{{ stats().total }}</p>
  </div>
  <div class="stat-card">
    <h3>Active</h3>
    <p class="stat-value">{{ stats().active }}</p>
  </div>
  <div class="stat-card">
    <h3>Inactive</h3>
    <p class="stat-value">{{ stats().inactive }}</p>
  </div>
</div>
```

---

## 🔲 Modal Components

### Create Modal

**File:** `components/{module}-create-modal/{module}-create-modal.component.ts`

```typescript
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { {Module}Service } from '../../services/{module}.service';
import { Create{Entity}Dto } from '../../interfaces/{module}.interface';

@Component({
  selector: 'app-{module}-create-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './{module}-create-modal.component.html',
  styleUrls: ['./{module}-create-modal.component.scss'],
})
export class {Module}CreateModalComponent {
  private fb = inject(FormBuilder);
  private {module}_service = inject({Module}Service);
  private toast_service = inject(ToastService);

  isSubmitting = false;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    phone_number: [''],
    is_active: [true],
  });

  onSubmit() {
    if (this.form.invalid) {
      return;
    }

    this.isSubmitting = true;
    const dto: Create{Entity}Dto = this.form.value;

    this.{module}_service.createEntity(dto).subscribe({
      next: () => {
        this.toast_service.show({
          variant: 'success',
          message: 'Entity created successfully',
        });
        this.isSubmitting = false;
        this.form.reset();
        this.close.emit();
      },
      error: (error) => {
        this.toast_service.show({
          variant: 'error',
          message: 'Error creating entity',
        });
        this.isSubmitting = false;
      },
    });
  }

  close = output<void>();
}
```

### Edit Modal

**File:** `components/{module}-edit-modal/{module}-edit-modal.component.ts`

```typescript
import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { {Module}Service } from '../../services/{module}.service';
import { {Entity}, Update{Entity}Dto } from '../../interfaces/{module}.interface';

@Component({
  selector: 'app-{module}-edit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './{module}-edit-modal.component.html',
  styleUrls: ['./{module}-edit-modal.component.scss'],
})
export class {Module}EditModalComponent {
  private fb = inject(FormBuilder);
  private {module}_service = inject({Module}Service);
  private toast_service = inject(ToastService);

  readonly entity = input.required<{Entity}>();
  close = output<void>();

  isSubmitting = false;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    phone_number: [''],
    is_active: [true],
  });

  ngOnInit() {
    this.patchForm();
  }

  private patchForm() {
    this.form.patchValue({
      name: this.entity().name,
      email: this.entity().email,
      phone_number: this.entity().phone_number || '',
      is_active: this.entity().is_active,
    });
  }

  onSubmit() {
    if (this.form.invalid) {
      return;
    }

    this.isSubmitting = true;
    const dto: Update{Entity}Dto = this.form.value;

    this.{module}_service.updateEntity(this.entity().id, dto).subscribe({
      next: () => {
        this.toast_service.show({
          variant: 'success',
          message: 'Entity updated successfully',
        });
        this.isSubmitting = false;
        this.close.emit();
      },
      error: (error) => {
        this.toast_service.show({
          variant: 'error',
          message: 'Error updating entity',
        });
        this.isSubmitting = false;
      },
    });
  }
}
```

---

## 📭 Empty State Component

**File:** `components/{module}-empty-state/{module}-empty-state.component.ts`

```typescript
import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-{module}-empty-state',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './{module}-empty-state.component.html',
  styleUrls: ['./{module}-empty-state.component.scss'],
})
export class {Module}EmptyStateComponent {
  readonly message = input<string>('No entities found');
  readonly icon = input<string>('inbox');
  readonly actionable = input<boolean>(true);

  createAction = output<void>();
}
```

**Template:** `components/{module}-empty-state/{module}-empty-state.component.html`

```html
<div class="empty-state">
  <app-icon [name]="icon()" [size]="64" />
  <p>{{ message() }}</p>
  @if (actionable()) {
    <button (click)="createAction.emit()">Create First</button>
  }
</div>
```

---

## 📄 Pagination Component

**File:** `components/{module}-pagination/{module}-pagination.component.ts`

```typescript
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-{module}-pagination',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './{module}-pagination.component.html',
  styleUrls: ['./{module}-pagination.component.scss'],
})
export class {Module}PaginationComponent {
  readonly currentPage = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly totalItems = input.required<number>();

  pageChange = output<number>();

  get pages(): number[] {
    const pages = [];
    const maxVisible = 5;
    const start = Math.max(1, this.currentPage() - Math.floor(maxVisible / 2));
    const end = Math.min(this.totalPages(), start + maxVisible - 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  onPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.pageChange.emit(page);
    }
  }
}
```

---

## 🔌 Service Layer

**File:** `services/{module}.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, takeUntil, Subject } from 'rxjs';
import { {Entity}, Create{Entity}Dto, Update{Entity}Dto, Query{Entity}Dto } from '../interfaces/{module}.interface';

@Injectable({
  providedIn: 'root',
})
export class {Module}Service {
  private http = inject(HttpClient);
  private api_url = '/api/{entities}';

  // Loading state
  private isLoading$$ = new BehaviorSubject<boolean>(false);
  isLoading$ = this.isLoading$$.asObservable();

  // Statistics
  private stats$$ = new BehaviorSubject<Stats>({
    total: 0,
    active: 0,
    inactive: 0,
  });
  stats$ = this.stats$$.asObservable();

  constructor() {
    this.loadStats();
  }

  getEntities(query: Query{Entity}Dto): Observable<PaginatedResponse<{Entity}>> {
    return this.http.get<PaginatedResponse<{Entity}>>(this.api_url, { params: query });
  }

  getEntity(id: number): Observable<{Entity}> {
    return this.http.get<{Entity}>(`${this.api_url}/${id}`);
  }

  createEntity(dto: Create{Entity}Dto): Observable<{Entity}> {
    return this.http.post<{Entity}>(this.api_url, dto);
  }

  updateEntity(id: number, dto: Update{Entity}Dto): Observable<{Entity}> {
    return this.http.put<{Entity}>(`${this.api_url}/${id}`, dto);
  }

  deleteEntity(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api_url}/${id}`);
  }

  private loadStats() {
    this.http.get<Stats>(`${this.api_url}/stats`).subscribe({
      next: (stats) => this.stats$$.next(stats),
    });
  }

  getStats() {
    return this.stats$$.value;
  }
}
```

---

## 📐 Interface Definitions

**File:** `interfaces/{module}.interface.ts`

```typescript
export interface {Entity} {
  id: number;
  name: string;
  email: string;
  phone_number?: string;
  is_active: boolean;
  organization_id: number;
  store_id: number;
  created_at: string;
  updated_at: string;
}

export interface Create{Entity}Dto {
  name: string;
  email: string;
  phone_number?: string;
  is_active?: boolean;
}

export interface Update{Entity}Dto {
  name?: string;
  email?: string;
  phone_number?: string;
  is_active?: boolean;
}

export interface Query{Entity}Dto {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      total_pages: number;
    };
  };
}

export interface Stats {
  total: number;
  active: number;
  inactive: number;
}
```

---

## 📦 Index Exports

**File:** `index.ts`

```typescript
export * from './{module-name}.component';
export * from './components';
export * from './services';
export * from './interfaces';
```

**File:** `components/index.ts`

```typescript
export * from './{module}-stats/{module}-stats.component';
export * from './{module}-create-modal/{module}-create-modal.component';
export * from './{module}-edit-modal/{module}-edit-modal.component';
export * from './{module}-empty-state/{module}-empty-state.component';
export * from './{module}-pagination/{module}-pagination.component';
```

---

## 🔍 Key Files Reference

| File | Purpose |
|------|---------|
| `{module}.component.ts` | Main component logic |
| `components/` | Sub-components |
| `services/{module}.service.ts` | API and business logic |
| `interfaces/{module}.interface.ts` | TypeScript interfaces |

---

## Related Skills

- `vendix-frontend-component` - Component structure (CRITICAL)
- `vendix-frontend-routing` - Routing patterns
- `vendix-naming-conventions` - Naming conventions (CRITICAL)
