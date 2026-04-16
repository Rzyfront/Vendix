---
name: vendix-frontend-component
description: Angular component structure rules and mandatory reuse of shared components.
metadata:
  scope: [root]
  auto_invoke: "Creating Angular components"
---

# Vendix Frontend Component Pattern

## REGLA CRITICA — Reutilizacion Obligatoria

> **OBLIGATORIO — Antes de crear un componente nuevo, SIEMPRE verificar si ya existe uno existente.**

El desarrollo en Vendix sigue una jerarquia de prioridades:

```
1. SHARED COMPONENT existente  ← PRIMERA OPCION (usar siempre)
2. SHARED COMPONENT adaptado  ← SEGUNDA OPCION (modificar uno existente)
3. Nuevo componente           ← ULTIMO RECURSO (solo cuando no hay alternativa)
```

**Antes de escribir codigo, el flujo es:**

```
1. Buscar en `apps/frontend/src/app/shared/components/`
2. Leer el README.md del componente encontrado
3. Verificar inputs, outputs y patrones de uso
4. Usar el componente (importandolo desde `@shared/components`)
5. Solo si NO existe, crear uno nuevo
```

---

## Catalogode Shared Components (54 componentes)

Todos disponibles en `apps/frontend/src/app/shared/components/`. **Antes de usar cualquiera, leer su README.md.**

### Form Inputs (8)

| Componente        | Selector             | Proposito                                          | README                     |
| ----------------- | -------------------- | -------------------------------------------------- | -------------------------- |
| `button/`         | `app-button`         | Boton configurable con variantes, tamanos, loading | `button/README.md`         |
| `input/`          | `app-input`          | Input de texto con label, error, prefix/suffix     | `input/README.md`          |
| `textarea/`       | `app-textarea`       | Textarea redimensionable                           | `textarea/README.md`       |
| `toggle/`         | `app-toggle`         | Toggle switch booleano                             | `toggle/README.md`         |
| `selector/`       | `app-selector`       | Selector desplegable (dropdown)                    | `selector/README.md`       |
| `multi-selector/` | `app-multi-selector` | Selector multiple con chips                        | `multi-selector/README.md` |
| `input-buttons/`  | `app-input-buttons`  | Grupo de botones de accion junto a input           | `input-buttons/README.md`  |
| `inputsearch/`    | `app-inputsearch`    | Input con icono de busqueda integrado              | `inputsearch/README.md`    |

### Data Display (7)

| Componente              | Selector                   | Proposito                                          | README                           |
| ----------------------- | -------------------------- | -------------------------------------------------- | -------------------------------- |
| `card/`                 | `app-card`                 | Tarjeta contenedor con headers opcionales          | `card/README.md`                 |
| `badge/`                | `app-badge`                | Etiqueta de estado con variantes de color          | `badge/README.md`                |
| `table/`                | `app-table`                | Tabla de datos con sorting, pagination, acciones   | `table/README.md`                |
| `pagination/`           | `app-pagination`           | Controles de paginacion                            | `pagination/README.md`           |
| `item-list/`            | `app-item-list`            | Lista de items en cards (mobile-first)             | `item-list/README.md`            |
| `responsive-data-view/` | `app-responsive-data-view` | Wrapper que alterna table/item-list por breakpoint | `responsive-data-view/README.md` |
| `empty-state/`          | `app-empty-state`          | Estado vacio con icono y mensaje                   | `empty-state/README.md`          |

### Feedback y Overlays (7)

| Componente            | Selector                               | Proposito                              | README                         |
| --------------------- | -------------------------------------- | -------------------------------------- | ------------------------------ |
| `alert-banner/`       | `app-alert-banner`                     | Banner de alerta fijo (top)            | `alert-banner/README.md`       |
| `spinner/`            | `app-spinner`                          | Indicador de carga animado             | `spinner/README.md`            |
| `tooltip/`            | `app-tooltip`                          | Tooltip flotante al hover              | `tooltip/README.md`            |
| `toast/`              | `app-toast-container` + `ToastService` | Notificaciones temporales              | `toast/README.md`              |
| `confirmation-modal/` | `app-confirmation-modal`               | Modal de confirmacion con acciones     | `confirmation-modal/README.md` |
| `prompt-modal/`       | `app-prompt-modal`                     | Modal con input de texto para prompts  | `prompt-modal/README.md`       |
| `image-lightbox/`     | `app-image-lightbox`                   | Visor de imagenes en pantalla completa | `image-lightbox/README.md`     |

### Navigation y Layout (8)

| Componente                | Selector               | Proposito                                  | README                             |
| ------------------------- | ---------------------- | ------------------------------------------ | ---------------------------------- |
| `icon/`                   | `app-icon`             | Iconos Lucide (registrados en registry)    | `icon/README.md`                   |
| `header/`                 | `app-header`           | Header principal de la app                 | `header/README.md`                 |
| `sidebar/`                | `app-sidebar`          | Barra lateral de navegacion                | `sidebar/README.md`                |
| `sticky-header/`          | `app-sticky-header`    | Header sticky (NO usar con padding parent) | `sticky-header/README.md`          |
| `dropdown/`               | `app-dropdown`         | Dropdown generico con trigger              | `dropdown/README.md`               |
| `options-dropdown/`       | `app-options-dropdown` | Dropdown con acciones/options              | `options-dropdown/README.md`       |
| `scrollable-tabs/`        | `app-scrollable-tabs`  | Tabs con scroll horizontal                 | `scrollable-tabs/README.md`        |
| `layouts/landing-layout/` | `app-landing-layout`   | Layout para landing pages publicas         | `layouts/landing-layout/README.md` |

### Specialized Inputs (5)

| Componente              | Selector                   | Proposito                      | README                           |
| ----------------------- | -------------------------- | ------------------------------ | -------------------------------- |
| `quantity-control/`     | `app-quantity-control`     | Control de cantidad (+/-)      | `quantity-control/README.md`     |
| `file-upload-dropzone/` | `app-file-upload-dropzone` | Zona de drop para archivos     | `file-upload-dropzone/README.md` |
| `markdown-editor/`      | `app-markdown-editor`      | Editor de markdown con preview | `markdown-editor/README.md`      |
| `setting-toggle/`       | `app-setting-toggle`       | Toggle con label y descripcion | `setting-toggle/README.md`       |
| `steps-line/`           | `app-steps-line`           | Linea de pasos/progreso        | `steps-line/README.md`           |

### AI, Charts y Complex (7)

| Componente                | Selector                     | Proposito                                       | README                             |
| ------------------------- | ---------------------------- | ----------------------------------------------- | ---------------------------------- |
| `ai-text-stream/`         | `app-ai-text-stream`         | Renderizado de streaming de texto token a token | `ai-text-stream/README.md`         |
| `ai-chat-widget/`         | `app-ai-chat-widget`         | Widget flotante de chat con IA                  | `ai-chat-widget/README.md`         |
| `chart/`                  | `app-chart`                  | Graficos ECharts (NO Chart.js)                  | `chart/README.md`                  |
| `stats/`                  | `app-stats`                  | Tarjeta de estadistica/KPI                      | `stats/README.md`                  |
| `timeline/`               | `app-timeline`               | Linea de tiempo vertical                        | `timeline/README.md`               |
| `notifications-dropdown/` | `app-notifications-dropdown` | Dropdown con lista de notificaciones            | `notifications-dropdown/README.md` |
| `user-dropdown/`          | `app-user-dropdown`          | Dropdown de perfil y menu de usuario            | `user-dropdown/README.md`          |

### App-level y Misc (11)

| Componente                 | Selector                         | Proposito                                            | README                              |
| -------------------------- | -------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| `app-loading/`             | `app-loading`                    | Pantalla de carga fullscreen                         | `app-loading/README.md`             |
| `development-placeholder/` | `app-development-placeholder`    | Placeholder para feature en desarrollo               | `development-placeholder/README.md` |
| `under-construction/`      | `app-under-construction`         | Pagina de construccion con titulo configurable       | `under-construction/README.md`      |
| `not-found-redirect/`      | `app-not-found-redirect`         | Redirect a 404 con logica de redireccion             | `not-found-redirect/README.md`      |
| `environment-indicator/`   | `app-environment-indicator`      | Indicador de entorno (DEV/STAGING) fijo              | `environment-indicator/README.md`   |
| `help-search-overlay/`     | `app-help-search-overlay`        | Overlay de busqueda con atajos de teclado            | `help-search-overlay/README.md`     |
| `global-user-modals/`      | `app-global-user-modals`         | Contenedor de modales de usuario (profile, settings) | `global-user-modals/README.md`      |
| `profile-modal/`           | `app-profile-modal`              | Modal de edicion de perfil de usuario                | `profile-modal/README.md`           |
| `settings-modal/`          | `app-settings-modal`             | Modal de configuracion de la app                     | `settings-modal/README.md`          |
| `onboarding-modal/`        | `app-onboarding-modal`           | Wizard de configuracion inicial                      | `onboarding-modal/README.md`        |
| `tour/`                    | `app-tour-modal` + `TourService` | Tours interactivos guiados (spotlight)               | `tour/README.md`                    |

### Modal Base (1)

| Componente | Selector    | Proposito                             | README            |
| ---------- | ----------- | ------------------------------------- | ----------------- |
| `modal/`   | `app-modal` | Modal base con two-way binding isOpen | `modal/README.md` |

---

## Flujo de Decision — Crear vs Reutilizar

```
¿Necesitas un boton?
  → SI → Usar `app-button`. Leer `button/README.md`.

¿Necesitas mostrar una lista de datos?
  → Mobile only → Usar `app-item-list`. Leer `item-list/README.md`.
  → Desktop only → Usar `app-table`. Leer `table/README.md`.
  → Ambos → Usar `app-responsive-data-view`. Leer `responsive-data-view/README.md`.

¿Necesitas un modal de confirmacion?
  → Usar `app-confirmation-modal`. Leer `confirmation-modal/README.md`.

¿Necesitas un modal generico?
  → Usar `app-modal` + crear componente wrapper. Leer `modal/README.md`.

¿Necesitas una notificacion temporal?
  → Usar `ToastService`. Leer `toast/README.md`.

¿Ninguno de los anteriores?
  → Buscar en el catalogo completo mas arriba.
  → ¿Existe? → Leer su README y usar.
  → ¿No existe? → CREAR NUEVO COMPONENTE (ver secciones siguientes).
```

---

## Exportacion Centralizada

Todos los shared components se exportan desde un punto central:

```typescript
import {
  ButtonComponent,
  InputComponent,
  TableComponent,
  // ... otros
} from "@shared/components";
```

**Archivo:** `apps/frontend/src/app/shared/components/index.ts`

Verificar siempre que el componente este exportado en `index.ts` antes de importarlo por ruta directa.

---

## Reglas de Estructura (Obligatorias al Crear)

### 1. Todo componente en carpeta

```
❌ WRONG — archivo suelto
app-button.component.ts

✅ CORRECT — carpeta
button/
├── button.component.ts
├── button.component.html
└── button.component.scss
```

### 2. Nombrado

- Carpeta: **kebab-case** (ej: `product-card/`)
- Archivos: **kebab-case** con sufijo (ej: `product-card.component.ts`)
- Clase: **PascalCase** (ej: `export class ProductCardComponent`)
- Selector: **kebab-case** con prefijo `app-` (ej: `app-product-card`)

### 3. Estructura de carpeta

```
{component-name}/
├── {component-name}.component.ts       # Logica
├── {component-name}.component.html     # Template
├── {component-name}.component.scss    # Estilos
├── {component-name}.component.spec.ts # Tests (opcional)
└── README.md                          # DOCUMENTACION OBLIGATORIA
```

### 4. Angular 20 Signals (obligatorio)

```typescript
// ✅ CORRECTO
readonly name = input.required<string>();
readonly isLoading = input<boolean>(false);
readonly items = input<MyItem[]>([]);

// ❌ PROHIBIDO — decoradores obsoletos
@Input() name!: string;
@Input() isLoading = false;
```

---

## Signal API — Patrones Angular 20 (Zoneless)

### Inputs y Outputs con Signals (PREFERIDO en codigo nuevo)

```typescript
import { Component, input, output, model, signal, computed, inject } from '@angular/core';

@Component({
  selector: 'app-my-component',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, // Recomendado
  template: `...`,
})
export class MyComponent {
  // --- Inputs ---
  readonly label = input<string>('');           // Opcional con default
  readonly items = input.required<Item[]>();    // Requerido — error en compilacion si falta
  readonly disabled = input<boolean>(false);

  // --- Outputs ---
  readonly itemSelected = output<Item>();
  readonly closed = output<void>();

  // --- Two-way binding (reemplaza @Input setter + @Output EventEmitter) ---
  readonly isOpen = model<boolean>(false);
  readonly value = model<string>('');

  // --- Estado local ---
  readonly isLoading = signal(false);
  readonly count = signal(0);

  // --- Computados ---
  readonly hasItems = computed(() => this.items().length > 0);
  readonly displayLabel = computed(() => this.label() || 'Sin etiqueta');

  // --- Uso ---
  selectItem(item: Item): void {
    this.itemSelected.emit(item);  // output() emite igual que EventEmitter
  }

  close(): void {
    this.isOpen.set(false);        // model() se actualiza con .set()
  }
}
```

### Uso desde el padre

```html
<!-- input() — property binding normal -->
<app-my-component [label]="'Titulo'" [items]="myItems()" />

<!-- output() — event binding normal -->
<app-my-component (itemSelected)="onSelect($event)" />

<!-- model() — two-way binding -->
<app-my-component [(isOpen)]="showModal" [(value)]="searchTerm" />
```

### Patrones legacy — aun funcionales pero NO usar en codigo nuevo

```typescript
// LEGACY — Compatible pero obsoleto en Vendix
@Input() label: string = '';
@Output() selected = new EventEmitter<Item>();
// Usar solo cuando se modifica un componente existente que ya usa este patron
```

### ChangeDetectorRef en Zoneless

Con Zoneless activo en Vendix, los signals disparan CD automaticamente:

```typescript
// Con signals — NO necesitas markForCheck()
readonly count = signal(0);
increment() { this.count.update(v => v + 1); } // CD automatico

// Si usas datos no-signal con OnPush (ej: respuesta HTTP directa)
// markForCheck() sigue siendo un escape hatch valido, pero preferir migrar a signals
```

---

## Patrones de Componente

### Componente Standalone

```typescript
import { Component, input, output, computed } from "@angular/core";
import { CommonModule } from "@angular/common";

@Component({
  selector: "app-feature-card",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./feature-card.component.html",
  styleUrls: ["./feature-card.component.scss"],
})
export class FeatureCardComponent {
  readonly title = input.required<string>();
  readonly description = input<string>("");
  readonly loading = input<boolean>(false);

  readonly featureChanged = output<string>();

  readonly displayTitle = computed(() => this.title().toUpperCase());

  onFeatureClick() {
    this.featureChanged.emit(this.title());
  }
}
```

### Comunicacion Parent-Child

```typescript
// Parent
template: `<app-feature-card [title]="myTitle" (featureChanged)="onFeatureChanged($event)" />`

// Child — inputs
readonly title = input.required<string>();

// Child — outputs
readonly featureChanged = output<string>();
```

### Two-Way Binding

```typescript
// Child — con model() (preferido, Angular 20)
readonly value = model<string>('');

// Child — con input/output manual (legacy, aun funcional)
readonly value = input<string>('');
readonly valueChange = output<string>();

// Parent — identico en ambos casos
template: `<app-custom-input [(value)]="myValue" />`
```

> **Angular 20**: Los ejemplos anteriores que usan decoradores `@Input()/@Output()` son por compatibilidad historica. En codigo nuevo, usar la Signal API: `input()`, `output()`, `model()`.

---

## Lifecycle y Performance

```typescript
export class DataComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.loadData().pipe(takeUntil(this.destroy$)).subscribe();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

// OnPush siempre que sea posible
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
```

---

## Documentacion de Nuevos Componentes

Al crear un nuevo componente, **OBLIGATORIO** crear su README.md en el mismo directorio:

````
# ComponentName

Descripcion en 1-2 lineas.

## Uso

```html
<!-- Ejemplo minimo funcional -->
````

## Inputs

| Input | Tipo | Default | Descripcion |
| ----- | ---- | ------- | ----------- |

## Outputs (si aplica)

| Output | Tipo | Descripcion |
| ------ | ---- | ----------- |

## Importante

- Gotchas o errores comunes.
- Patrones que DEBEN seguirse.

```

**Reglas del README:**
- Sin emojis
- Sin secciones vacias
- En espanol
- ~30-80 lineas

---

## Referencia de Archivos Clave

| Archivo | Proposito |
|---------|-----------|
| `shared/components/index.ts` | Exportaciones centralizadas |
| `app/shared/components/*/` | Componentes reutilizables |
| `app/private/modules/*/components/` | Componentes de modulo especifico |

---

## Related Skills

- `vendix-frontend-module` - Estructura de modulos Angular
- `vendix-frontend-routing` - Patrones de enrutamiento
- `vendix-frontend-data-display` - Table, ItemList, ResponsiveDataView
- `vendix-frontend-modal` - Patrones de modal
- `vendix-frontend-stats-cards` - Tarjetas de estadisticas
- `vendix-naming-conventions` - Convenciones de nombr ado (CRITICAL)
- `buildcheck-dev` - Verificacion de build (CRITICAL)
```
