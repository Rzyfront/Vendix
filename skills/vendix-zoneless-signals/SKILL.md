---
name: vendix-zoneless-signals
description: Patrones Zoneless y Signals en Angular 20 — setup, input/output signals, toSignal en facades, @defer, y antipatrones a evitar.
metadata:
  scope: [root]
  auto_invoke: "Creating Angular components, Managing State, Creating or modifying modals in frontend"
---

# Vendix — Zoneless + Signals (Angular 20)

Vendix completó la migración a Angular 20 Zoneless + Signals en sus 529 componentes.
Este skill documenta los patrones adoptados y los antipatrones a evitar.

**Auditoría automatizada** (ejecutar en CI para garantizar 0 regresiones):

```bash
# Todos deben devolver 0
grep -rln "@Input(\|@Output(" apps/frontend/src/app --include="*.ts" | wc -l
grep -rln "EventEmitter" apps/frontend/src/app --include="*.ts" | wc -l
grep -rln "NgZone" apps/frontend/src/app --include="*.ts" | grep -v app.config.ts | wc -l
grep -rln "markForCheck\|detectChanges" apps/frontend/src/app --include="*.ts" | wc -l
grep -rlE "\| async" apps/frontend/src/app --include="*.html" | wc -l
grep -rlE "\*ngIf|\*ngFor" apps/frontend/src/app --include="*.html" --include="*.ts" | wc -l

# Variables planas de UI state sospechosas (revisar manualmente los hits)
# Umbral esperado: 0 hits reales de UI state. Falsos positivos posibles en config/constantes; revisar cada match.
grep -rnE "^\s+(loading|isOpen|saving|submitted|is_loading|search_term|filter_values|query_params)\s*(:\s*\w+)?\s*=\s*(false|true|'|\"|\{|\[|null)" apps/frontend/src/app --include="*.component.ts" | wc -l

# BehaviorSubject/new Subject en componentes — objetivo: solo usos legitimos (destroy$, search streams con debounceTime/switchMap)
# Umbral esperado: un numero bajo y acotado (no crecer). Revisar cada archivo para verificar uso legitimo.
grep -rl "BehaviorSubject\|new Subject<" apps/frontend/src/app --include="*.component.ts" | wc -l

# take(1).subscribe sincrono — debe = 0 en toda la app (ya cubierto por migracion a signals)
grep -rln "take(1)" apps/frontend/src/app --include="*.ts" | wc -l
```

---

## 1. Setup Zoneless (`app.config.ts`)

```typescript
// CORRECTO — Zoneless activo en Vendix
import { provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(), // SIN zone.js
    // ...
  ]
};
```

- `zone.js` **NO** está en polyfills de `angular.json`
- NgRx: `strictActionWithinNgZone: false`

---

## 2. Signal Inputs/Outputs (Angular 20)

```typescript
// NUEVO — Signal API (preferido)
import { input, output, model } from '@angular/core';

@Component({...})
export class MyComponent {
  // Inputs
  readonly label = input<string>('');         // opcional con default
  readonly items = input.required<Item[]>();  // requerido

  // Outputs
  readonly selected = output<Item>();

  // Two-way binding (reemplaza @Input setter + @Output EventEmitter)
  readonly isOpen = model<boolean>(false);

  // En template: [(isOpen)]="parentFlag"
}
```

```typescript
// LEGACY — Aún funciona pero NO usar en código nuevo
@Input() label: string = '';
@Output() selected = new EventEmitter<Item>();
```

---

## 3. `toSignal()` en Facades

```typescript
// PATRÓN VENDIX — Todas las facades tienen signals paralelos
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthFacade {
  // Observable (backward compatible)
  readonly user$ = this.store.select(AuthSelectors.selectUser);

  // Signal parallel (preferido para nuevos componentes)
  readonly user = toSignal(this.user$);

  // Con initialValue para evitar undefined
  readonly isAuthenticated = toSignal(this.isAuthenticated$, { initialValue: false });
  readonly userRoles = toSignal(this.userRoles$, { initialValue: [] as string[] });
}
```

```typescript
// ANTIPATRÓN — take(1).subscribe síncrono
// ❌ NUNCA hacer esto:
isModuleVisible(key: string): boolean {
  let result = false;
  this.store.select(selector).pipe(take(1)).subscribe(v => result = v);
  return result;
}

// ✅ CORRECTO — leer la señal directamente:
isModuleVisible(key: string): boolean {
  return this.visibleModules().includes(key);
}
```

---

## 4. Templates — consumir signals

```typescript
// En componentes que consumen facades
@Component({...})
export class MyComponent {
  private authFacade = inject(AuthFacade);

  // Leer señales de facades directamente
  readonly user = this.authFacade.user;           // Signal<User | undefined>
  readonly isAuth = this.authFacade.isAuthenticated; // Signal<boolean>
}
```

```html
<!-- Template — sin async pipe cuando se usan signals -->
@if (isAuth()) {
  <p>Hola {{ user()?.name }}</p>
}

<!-- Con async pipe — aún válido con Observables -->
<p>{{ user$ | async }}</p>
```

---

## 5. `@defer` para lazy loading de secciones pesadas

```html
<!-- Lazy load al entrar en viewport -->
@defer (on viewport) {
  <app-heavy-component />
} @placeholder {
  <div class="h-48 animate-pulse bg-gray-100 rounded"></div>
}

<!-- Lazy load condicional por signal -->
@defer (when showAdvanced()) {
  <app-advanced-section />
}

<!-- Con loading state explícito -->
@defer (on interaction) {
  <app-chart [data]="data()" />
} @loading {
  <app-spinner />
} @error {
  <p>Error cargando</p>
}
```

---

## 6. NgZone — patrón eliminado

```typescript
// ❌ OBSOLETO — NO usar NgZone.run() en Vendix
// Vendix es Zoneless — NgZone.run() es un no-op y agrega overhead innecesario

// Antes (Zone-based):
this.eventSource.onopen = () => {
  this.ngZone.run(() => observer.next(action()));
};

// ✅ AHORA (Zoneless):
this.eventSource.onopen = () => {
  observer.next(action()); // directo, sin wrapper
};
```

---

## 7. ChangeDetectorRef — cuándo aún es necesario

```typescript
// Con signals — NO necesitas markForCheck()
// Los signals disparan CD automáticamente

// ✅ Con signals: automático
readonly count = signal(0);
increment() { this.count.update(v => v + 1); } // CD automático

// Si usas datos no-signal con OnPush — markForCheck() aún válido como escape hatch
// Pero preferir migrar a signals sobre agregar markForCheck()
```

---

## 8. Resumen de decisiones

| Patrón | Estado | Alternativa |
|--------|--------|-------------|
| `@Input()/@Output()` | Legacy — funciona pero no usar en nuevo código | `input()/output()/model()` |
| `take(1).subscribe()` síncronamente | ❌ Antipatrón | Señal del facade |
| `NgZone.run()` | ❌ Eliminado | Directo — Zoneless |
| `provideZoneChangeDetection` | ❌ Eliminado | `provideZonelessChangeDetection()` |
| `cdr.markForCheck()` | Escape hatch — solo si no hay signals | Migrar a signals |
| `async pipe` | ✅ Válido con Observables | `toSignal()` para acceso síncrono |
| `| async` en template | ✅ Compatible con Zoneless | Signals si necesitas sincronía |
| Variables planas de UI state (`loading = false`, `search_term = ''`) | ❌ Antipatrón | `signal()` / `computed()` |
| `BehaviorSubject` para booleano UI | ❌ Antipatrón | `signal()` |
| `Subject<void>` para `destroy$` | ✅ Legítimo | conservar |
| `Subject` con `debounceTime`/`switchMap` | ✅ Legítimo | conservar |

---

## 9. Antipatrón: variables planas de UI state

En Zoneless, **reasignar una propiedad de clase NO dispara change detection**. Cualquier estado que
el template necesite observar debe ser un `signal()` (o un `computed()` derivado).

```typescript
// ❌ ANTES — variables planas: el template NO se actualiza al reasignar
@Component({...})
export class InvoiceListComponent {
  loading = false;
  search_term = '';
  filter_values: Record<string, unknown> = {};

  load() {
    this.loading = true;                   // template NO re-renderiza
    this.api.list().subscribe(() => {
      this.loading = false;                // template NO re-renderiza
    });
  }

  onSearch(value: string) {
    this.search_term = value;              // template NO refleja el cambio
  }
}
```

```html
<!-- Template legacy -->
<div *ngIf="loading">Cargando...</div>
<input [(ngModel)]="search_term" />
<span>{{ search_term }}</span>
```

```typescript
// ✅ DESPUÉS — signals: CD automático, sin markForCheck
import { signal, computed } from '@angular/core';
import { FormControl } from '@angular/forms';

@Component({...})
export class InvoiceListComponent {
  readonly loading = signal(false);
  readonly searchControl = new FormControl('', { nonNullable: true });
  // o, si se prefiere signal-only:
  readonly searchTerm = signal('');
  readonly filterValues = signal<Record<string, unknown>>({});

  load() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  onSearch(value: string) {
    this.searchTerm.set(value);
  }
}
```

```html
<!-- Template Zoneless-friendly -->
@if (loading()) {
  <div>Cargando...</div>
}

<!-- Opción A: FormControl (preferido cuando hay debounce/validación) -->
<input [formControl]="searchControl" />
<span>{{ searchControl.value }}</span>

<!-- Opción B: signal writable + model() si el input es two-way -->
<span>{{ searchTerm() }}</span>
```

**Reglas de migración:**

- Toda propiedad mutable leída por el template → `signal()`.
- `{{ search_term }}` → `{{ search_term() }}` (invocar la señal).
- `[(ngModel)]="flag"` → `model<boolean>(false)` + `[(ngModel)]="flag"` con lectura `flag()`, o migrar a `FormControl` + `[formControl]`.
- Derivados (ej. `filteredItems`) → `computed(() => ...)`, no recalcular en métodos imperativos.

---

## 10. BehaviorSubject / Subject en componentes — cuándo SÍ, cuándo NO

Regla general: **estado UI simple = `signal()`**. Los `Subject` sólo deben quedar cuando se usa su
semántica reactiva (cancelación, streams temporales, composición RxJS).

| Caso | Decisión | Motivo |
|------|----------|--------|
| `loadingSubject = new BehaviorSubject(false)` | ❌ Migrar a `signal(false)` | Estado puntual, sin composición |
| `isOpenSubject = new BehaviorSubject(false)` | ❌ Migrar a `signal(false)` o `model<boolean>(false)` | Flag UI |
| `countSubject = new BehaviorSubject(0)` | ❌ Migrar a `signal(0)` | Valor escalar |
| `selectedIdSubject = new BehaviorSubject<string \| null>(null)` | ❌ Migrar a `signal<string \| null>(null)` | Estado puntual |
| `destroy$ = new Subject<void>()` con `takeUntil(destroy$)` | ✅ Conservar | Cancelación de streams en `ngOnDestroy` |
| `search$ = new Subject<string>()` + `debounceTime + distinctUntilChanged + switchMap` | ✅ Conservar | Flujo temporal con operadores RxJS |
| Combinar cambios de form con `valueChanges` + `combineLatest`/`switchMap` | ✅ Conservar | Composición de streams |
| Canal pub/sub entre componentes (event bus local) | ✅ Conservar | Semántica de eventos |

```typescript
// ❌ ANTIPATRÓN — Subject como holder de estado UI
private loadingSubject = new BehaviorSubject(false);
readonly loading$ = this.loadingSubject.asObservable();
setLoading(v: boolean) { this.loadingSubject.next(v); }

// ✅ CORRECTO
readonly loading = signal(false);
setLoading(v: boolean) { this.loading.set(v); }
```

```typescript
// ✅ LEGÍTIMO — destroy$ con takeUntil
private readonly destroy$ = new Subject<void>();

ngOnInit() {
  this.service.stream$.pipe(takeUntil(this.destroy$)).subscribe(...);
}
ngOnDestroy() {
  this.destroy$.next();
  this.destroy$.complete();
}
```

```typescript
// ✅ LEGÍTIMO — search stream con debounce/switchMap
private readonly search$ = new Subject<string>();
readonly results = toSignal(
  this.search$.pipe(
    debounceTime(250),
    distinctUntilChanged(),
    switchMap(q => this.api.search(q)),
  ),
  { initialValue: [] },
);

onSearch(term: string) { this.search$.next(term); }
```

> Alternativa moderna a `destroy$`: `takeUntilDestroyed()` (de `@angular/core/rxjs-interop`), que no requiere Subject manual. Preferido en componentes nuevos.

---

## 11. Aclaración: `zone.js` en `angular.json`

La auditoría estructural dice que "Vendix NO incluye `zone.js` en polyfills". Esto aplica a los
targets de **producción** (`build`, `serve`, `server`). La presencia de `zone.js` bajo el target
`test` de `apps/frontend/angular.json` es **LEGÍTIMA** y esperada:

- Karma/Jasmine requieren zone.js para parchear timers, `fakeAsync`, `TestBed.tick()`, etc.
- El runner de tests de Angular sigue siendo zone-aware aunque la app sea Zoneless en runtime.
- Quitarlo del target `test` rompe la suite de pruebas unitarias.

**Regla de auditoría:**

| Target en `angular.json` | `zone.js` permitido | Nota |
|--------------------------|---------------------|------|
| `build` | ❌ NO | Regresión — bundle zoneless debe quedar limpio |
| `serve` | ❌ NO | Dev server debe reflejar zoneless |
| `server` (SSR) | ❌ NO | SSR también zoneless |
| `test` | ✅ SÍ | Requerido por Karma/Jasmine |

Verificación rápida:

```bash
# Debe devolver 0 — zone.js no debe estar en build/serve/server
grep -nE '"(build|serve|server)"' -A 40 apps/frontend/angular.json | grep -c "zone.js"

# Debe devolver >=1 — zone.js legitimo bajo target test
grep -nE '"test"' -A 40 apps/frontend/angular.json | grep -c "zone.js"
```
