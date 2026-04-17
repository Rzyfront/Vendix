---
name: vendix-zoneless-signals
description: Patrones Zoneless y Signals en Angular 20 — setup, input/output signals, toSignal en facades, @defer, y antipatrones a evitar.
metadata:
  scope: [root]
  priority: critical
  auto_invoke:
    - "Editing or creating any Angular component under apps/frontend (Zoneless patterns apply)"
    - "Using input(), output(), model(), signal(), computed(), effect(), or toSignal()"
    - "Implementing ControlValueAccessor (CVA) in custom form components"
    - "Debugging stale templates, missing re-renders, or change detection issues"
    - "Reviewing or replacing NgZone, markForCheck, detectChanges, @Input, @Output, EventEmitter"
    - "Migrating legacy Angular patterns (BehaviorSubject, take(1).subscribe) to Signals"
    - "Auditing Zoneless compliance (zoneless-audit.sh) or enforcing CI grep rules"
    - "Working with @defer, @if, @for control flow blocks in templates"
    - "Using toSignal() in facades — validating initialValue presence"
    - "Fixing signal-used-without-invoking bugs (!this.flag vs !this.flag())"
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

# Signal usado sin invocar — heuristica, revisar manualmente (bug tipo "!this.disabled")
# Falsos positivos: metodos reales, propiedades no-signal. Foco: props que sabes que son signals.
grep -rnE "(!|if\s*\(|while\s*\()this\.(disabled|loading|readonly|isOpen|saving|submitted|required)\s*(\)|&&|\|\||\s*$)" \
  apps/frontend/src/app --include="*.ts" | grep -vE "this\.\w+\(" | wc -l

# toSignal sin initialValue en facades — umbral esperado: 0 (o justificado caso a caso)
grep -rnE "toSignal\(\s*this\.\w+\$\s*\)\s*;" apps/frontend/src/app --include="*.facade.ts" | wc -l
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
| Signal usado sin invocar (`!this.disabled`, `if (this.loading)`) | ❌ Antipatrón silencioso | invocar: `!this.disabled()`, `if (this.loading())` |
| Leer `toSignal()` sin `initialValue` en `ngOnInit` | ❌ Antipatrón | añadir `initialValue` o suscribirse al `$` / usar `effect()` |
| Campos planos en CVA (`value = false`, `disabled = false` mutados por `writeValue`/`setDisabledState`) | ❌ Antipatrón — CD no dispara, template queda stale | `signal()` en CVA (§9.1) |
| `output()` emitido sólo desde métodos imperativos cuando depende de un `model()` | ❌ Antipatrón — se pierde en two-way binding | `effect()` que observe el signal y emita en transiciones (§14) |

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

## 9.1. Antipatrón: variables planas dentro de `ControlValueAccessor`

Caso especial de §9, fácil de pasar por alto porque la mutación **no viene del propio componente** sino del callback registrado por el formulario. Aplica a cualquier custom CVA: toggles, inputs custom, selects propios, date pickers, etc.

Con Zoneless, los callbacks `writeValue` y `setDisabledState` que el ReactiveForms invoca sobre el CVA mutan campos desde fuera del ciclo normal de eventos del componente. Si esos campos no son señales, el template **no re-renderiza** aunque el valor cambió.

```typescript
// ❌ ANTIPATRÓN — campos planos mutados por writeValue / setDisabledState
@Component({
  selector: 'app-my-toggle',
  template: `
    <div [class.opacity-50]="disabled" (click)="onToggle(!value)">
      <span [class.on]="value"></span>
    </div>
  `,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MyToggleComponent), multi: true },
  ],
})
export class MyToggleComponent implements ControlValueAccessor {
  value = false;      // ❌ mutado desde writeValue — template NO refleja
  disabled = false;   // ❌ mutado desde setDisabledState — template NO refleja

  writeValue(v: boolean) { this.value = !!v; }                // CD no dispara
  setDisabledState(d: boolean) { this.disabled = d; }         // CD no dispara
}
```

**Síntomas típicos**

- Click a un toggle "se siente" lento — el estado en memoria cambia pero la UI actualiza recién en el próximo tick disparado por otra señal.
- Al iterar con `control.patchValue()` / `enable()` / `disable()` sobre múltiples hijos (ej. sincronizar un parent toggle con sus children), el lag se acumula N veces porque cada `writeValue` no dispara CD, y sólo al final un tick natural repinta todo.
- Un control que el form deshabilita (`control.disable()`) sigue visualmente habilitado hasta que el usuario interactúa con otra parte de la pantalla.

```typescript
// ✅ CORRECTO — signals en CVA
@Component({
  selector: 'app-my-toggle',
  template: `
    <div [class.opacity-50]="disabled()" (click)="onToggle(!value())">
      <span [class.on]="value()"></span>
    </div>
  `,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MyToggleComponent), multi: true },
  ],
})
export class MyToggleComponent implements ControlValueAccessor {
  readonly value = signal(false);
  readonly disabled = signal(false);

  writeValue(v: boolean) { this.value.set(!!v); }             // CD automático
  setDisabledState(d: boolean) { this.disabled.set(d); }      // CD automático

  onToggle(v: boolean) {
    if (this.disabled()) return;
    this.value.set(v);
    this.onChange(v);
  }

  private onChange: (v: boolean) => void = () => {};
  registerOnChange(fn: (v: boolean) => void) { this.onChange = fn; }
  registerOnTouched(_: () => void) {}
}
```

**Regla**: en un CVA Zoneless, todo campo escrito por `writeValue` o `setDisabledState` que el template lee **debe** ser `signal()`. No hay excepción — ni siquiera para booleans simples. Los callbacks del form son el punto de entrada más común de "mutaciones invisibles para CD".

**Heurística de auditoría** (combinar con `implements ControlValueAccessor`):

```bash
# Archivos con CVA que declaran campos planos mutables
grep -rln "implements ControlValueAccessor" apps/frontend/src/app --include="*.ts" \
  | xargs grep -lnE "^\s+(value|disabled|checked|selected)\s*(:\s*\w+)?\s*=\s*(false|true|'|\"|null|0)"
```

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

## 11. Antipatrón: signal usado sin invocar como función

Los `input()`, `signal()`, `computed()`, `toSignal()` retornan una **función getter**, no el valor.
Usarlos sin los paréntesis compila, pero evalúa la **referencia a la función** — que siempre es
truthy. Bug silencioso: TypeScript no lo marca porque `!<function>` es válido.

```typescript
// ❌ BUG SILENCIOSO — `disabled` es InputSignal<boolean>, no boolean
readonly disabled = input<boolean>(false);

togglePasswordVisibility(): void {
  if (!this.disabled) {                 // ← `!<function>` = false SIEMPRE
    this.showPassword.set(!this.showPassword()); // nunca entra
  }
}

// ❌ Mismo patrón con signal()
readonly loading = signal(false);
onSubmit() {
  if (this.loading) return;             // ← siempre truthy → siempre sale
}

// ❌ En template (menos común, pero posible con expresiones)
@if (loading) {  <!-- objeto truthy --> }
```

```typescript
// ✅ CORRECTO — invocar siempre con ()
if (!this.disabled()) { ... }
if (this.loading()) return;

// ✅ En template
@if (loading()) { ... }
{{ user()?.name }}
```

**Síntomas típicos**

- Un toggle/botón "no hace nada" tras migración a signals.
- Un `if (flag)` nunca entra a la rama `else`.
- Un `disabled` nunca se respeta.

**Heurística de auditoría** (falsos positivos posibles — revisar manualmente):

```bash
# Buscar `!this.<name>` sin paréntesis dentro de if/while/&&/||
grep -rnE "(!|if\s*\(|while\s*\(|&&\s*|\|\|\s*)this\.\w+\s*(\)|&&|\|\||\s*$)" \
  apps/frontend/src/app --include="*.ts" \
  | grep -vE "this\.\w+\(" | head -50
```

---

## 12. Antipatrón: leer `toSignal()` sin `initialValue` en `ngOnInit`

`toSignal(obs$)` devuelve `undefined` hasta que el observable emita por primera vez.
Si una facade expone `readonly data = toSignal(data$)` y el componente lee `facade.data()`
sincrónicamente en `ngOnInit`, verá `undefined` si el observable aún no ha emitido (HTTP
pendiente, NgRx effect en vuelo, etc.). Race condition silenciosa.

```typescript
// ❌ Facade sin initialValue
@Injectable({ providedIn: 'root' })
export class ConfigFacade {
  readonly appConfig$ = this.store.select(selectAppConfig);
  readonly appConfig = toSignal(this.appConfig$);  // ← empieza undefined

  getCurrentConfig(): AppConfig | null {
    return this.appConfig() ?? null;  // null si HTTP aún no resuelve
  }
}

// ❌ Componente — lectura única en ngOnInit
ngOnInit() {
  const cfg = this.configFacade.getCurrentConfig(); // puede ser null
  if (!cfg) return;                                  // early-return silencioso
  this.contextType = cfg.domainConfig.environment;   // queda con default → bug UI
}
```

**Soluciones** (elegir la que aplique):

```typescript
// ✅ Opción A — facade con initialValue explícito
readonly appConfig = toSignal(this.appConfig$, { initialValue: null as AppConfig | null });
readonly isLoading = toSignal(this.isLoading$, { initialValue: true });
```

```typescript
// ✅ Opción B — suscripción reactiva con takeUntilDestroyed
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

private destroyRef = inject(DestroyRef);

ngOnInit() {
  this.configFacade.appConfig$
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(cfg => {
      if (!cfg) return;
      this.contextType = cfg.domainConfig.environment;
    });
}
```

```typescript
// ✅ Opción C — effect() para reaccionar a cambios del signal
import { effect } from '@angular/core';

constructor() {
  effect(() => {
    const cfg = this.configFacade.appConfig();
    if (!cfg) return;
    this.contextType = cfg.domainConfig.environment;
  });
}
```

**Regla de facades Vendix:** todo `toSignal(...)` en una facade debe declarar `initialValue`
(preferiblemente `null` para objetos, `false` para booleanos, `[]` para listas) **o** documentar
por qué se permite `undefined`.

**Heurística de auditoría:**

```bash
# toSignal sin initialValue — revisar cada hit
grep -rnE "toSignal\(\s*this\.\w+\$\s*\)" apps/frontend/src/app --include="*.ts" | head -30

# Componentes que llaman get<Algo>Config() en ngOnInit sin subscribe previo
grep -rnB2 "getCurrentConfig\(\)\|this\.\w+Facade\.get\w+\(\)" \
  apps/frontend/src/app --include="*.component.ts" | head -40
```

---

## 13. Aclaración: `zone.js` en `angular.json`

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

---

## 14. Antipatrón: `model()` con outputs manuales que no reaccionan al two-way binding

Con `model()`, el signal se puede mutar desde **dos lados**: el propio componente (`this.foo.set(x)`) y el parent via `[(foo)]="bar"`. Cualquier `output()` derivado del cambio de ese signal debe dispararse con `effect()`, no desde métodos imperativos — si no, los cambios externos quedan mudos.

```typescript
// ❌ ANTIPATRÓN — opened/closed sólo se emiten desde open()/close() imperativos
@Component({ selector: 'app-modal', ... })
export class ModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly opened = output<void>();
  readonly closed = output<void>();

  open() {
    this.isOpen.set(true);
    this.opened.emit();   // se emite sólo cuando el propio componente llama open()
  }

  close() {
    this.isOpen.set(false);
    this.closed.emit();   // idem
  }
}
```

```html
<!-- Parent abre el modal via two-way -->
<app-modal [(isOpen)]="modalVisible" (opened)="loadData()"></app-modal>
```

```typescript
// Parent hace:
this.modalVisible = true;
// ↓
// isOpen del modal cambia a true — pero opened NUNCA emite
// → loadData() jamás se ejecuta — el contenido del modal queda vacío
```

**Síntomas típicos**

- Modal que se abre visualmente pero no carga datos / no ejecuta el setup — el binding funciona pero el output callback no dispara.
- Abrir/cerrar desde el parent "no hace nada reactivo" (solo cambia la visibilidad).
- Funciona cuando el usuario clickea el botón de cerrar del propio modal (porque llama `close()` imperativo), pero rompe cuando el cierre viene desde afuera.

```typescript
// ✅ CORRECTO — effect() observa el signal del model y emite outputs en transiciones
@Component({ selector: 'app-modal', ... })
export class ModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly opened = output<void>();
  readonly closed = output<void>();

  private previousIsOpen = false;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open !== this.previousIsOpen) {
        if (open) this.opened.emit();
        else this.closed.emit();
        this.previousIsOpen = open;
      }
    });
  }

  open()  { this.isOpen.set(true); }   // el effect se encarga de emitir
  close() { this.isOpen.set(false); }  // idem
}
```

**Regla**: cualquier `output()` semánticamente atado al cambio de un `model()` (o de cualquier signal writable) **debe** emitirse desde un `effect()` que observe la transición, no desde métodos imperativos. Los métodos imperativos se pierden el camino del two-way binding.

**Alternativa — evitar el output redundante**:

Si el parent sólo necesita reaccionar al cambio, suele bastar con el `change` auto-emitido por `model()` (ej. `isOpenChange`):

```html
<!-- model() genera automáticamente isOpenChange -->
<app-modal [(isOpen)]="modalVisible"></app-modal>
<!-- o -->
<app-modal [isOpen]="modalVisible" (isOpenChange)="onVisibilityChange($event)"></app-modal>
```

Sólo definir outputs explícitos (`opened`, `closed`) cuando su semántica difiere del cambio crudo del signal (ej. `opened` sólo en la transición `false → true`, no en cada set). Para ese caso sí aplica el patrón con `effect()`.
