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
