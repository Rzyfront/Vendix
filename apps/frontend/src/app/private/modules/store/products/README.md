# Componente de Productos - Guía de Patrones de Diseño

## 📋 Overview

El componente de productos (`ProductListComponent`) implementa los patrones de diseño estándar de Vendix y sirve como referencia para el desarrollo de otros módulos en la aplicación.

## 🏗️ Arquitectura del Componente

### Estructura de Archivos

```
components/product-list/
├── product-list.component.ts      # Lógica principal del componente
├── product-list.component.html   # Template con estructura estándar
├── product-list.component.css    # Estilos específicos (mínimos)
└── index.ts                    # Export del componente
```

### Patrones Arquitectónicos

#### 1. **Componentes Standalone**

- Todos los componentes deben ser `standalone: true`
- Imports explícitos en el decorador `@Component`
- Sin NgModules a menos que sea absolutamente necesario

#### 2. **ChangeDetectionStrategy.OnPush**

- Uso obligatorio de `ChangeDetectionStrategy.OnPush`
- Mejora performance y prevenir renderizados innecesarios
- Forzar actualizaciones manuales cuando sea necesario

## 🎨 Patrones de Diseño Visual

### 1. **Estructura Principal**

```html
<div class="space-y-6">
  <!-- Estadísticas (siempre arriba) -->
  <app-stats-grid></app-stats-grid>

  <!-- Contenedor principal de datos -->
  <div class="bg-surface rounded-card shadow-card border border-border min-h-[600px]">
    <!-- Header con controles -->
    <div class="px-6 py-4 border-b border-border">
      <!-- Contenido del header -->
    </div>

    <!-- Contenido dinámico -->
    <div class="p-6">
      <!-- Estados: loading, empty, data -->
    </div>
  </div>
</div>
```

### 2. **Tokens CSS Obligatorios**

- **Fondos**: `var(--color-surface)`
- **Bordes**: `var(--color-border)`
- **Texto primario**: `var(--color-text-primary)`
- **Texto secundario**: `var(--color-text-secondary)`
- **Primario**: `var(--color-primary)`
- **Destructivo**: `var(--color-destructive)`

### 3. **Clases de Utilidad Estándar**

#### Contenedores

```css
.bg-surface              /* Fondo principal */
.rounded-card            /* Bordes redondeados estándar */
.shadow-card             /* Sombra sutil */
.border-border           /* Borde estándar */
.min-h-[600px]          /* Altura mínima para dropdowns */
```

#### Espaciado

```css
.space-y-6               /* Espaciado vertical entre secciones */
.px-6 py-4              /* Padding estándar de headers */
.p-6                     /* Padding estándar de contenido */
.gap-3 / gap-4          /* Gap entre elementos */
```

#### Grids

```css
.grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4  /* Grid responsive estándar */
```

## 🧩 Componentes Compartidos

### 1. **Estadísticas - StatsComponent**

```html
<app-stats title="Título de la Métrica" [value]="formatNumber(valor)" [smallText]="texto secundario opcional" iconName="nombre-icono" iconBgColor="bg-primary/10" iconColor="text-primary"></app-stats>
```

### 2. **Tabla - TableComponent**

```html
<app-table [data]="dataArray" [columns]="tableColumns" [actions]="tableActions" [loading]="isLoading" [sortable]="true" [hoverable]="true" [striped]="true" size="md" (sort)="onTableSort($event)" (rowClick)="viewItem($event)"></app-table>
```

### 3. **Búsqueda - InputsearchComponent**

```html
<app-inputsearch placeholder="Buscar..." [debounceTime]="1000" [(ngModel)]="searchTerm" (ngModelChange)="onSearchChange($event)" size="sm"></app-inputsearch>
```

### 4. **Selectores - SelectorComponent**

```html
<app-selector [options]="selectorOptions" [(ngModel)]="selectedValue" (valueChange)="onValueChange($event)" size="sm" placeholder="Seleccionar opción"></app-selector>
```

### 5. **Botones - ButtonComponent**

```html
<app-button variant="primary|secondary|outline|ghost|danger" size="sm|md|lg" (clicked)="handleClick()" [disabled]="isLoading" [loading]="isSubmitting">
  <app-icon name="icon-name" [size]="16" slot="icon"></app-icon>
  Texto del botón
</app-button>
```

### 6. **Dropdowns Personalizados**

```html
<div class="filter-dropdown-container" #dropdownContainer>
  <button type="button" class="filter-dropdown-trigger" (click)="toggleDropdown()">
    <!-- Contenido del trigger -->
  </button>

  <div *ngIf="isOpen" class="filter-dropdown-content">
    <!-- Contenido del dropdown -->
  </div>
</div>
```

## 📊 Estados de la Interfaz

### 1. **Estado de Carga**

```html
<div *ngIf="isLoading" class="p-8 text-center">
  <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  <p class="mt-2 text-text-secondary">Cargando...</p>
</div>
```

### 2. **Estado Vacío**

```html
<app-empty-state *ngIf="!isLoading && items.length === 0" [title]="getEmptyStateTitle()" [description]="getEmptyStateDescription()" [showAdditionalActions]="hasFilters" (actionClick)="createItem()" (refreshClick)="refreshItems()" (clearFiltersClick)="clearFilters()"></app-empty-state>
```

### 3. **Estado con Datos**

```html
<div *ngIf="!isLoading && items.length > 0">
  <!-- Contenido principal -->
</div>
```

## 🔧 Patrones de Lógica

### 1. **Manejo de Estado**

```typescript
export class ComponentListComponent implements OnInit, OnDestroy {
  // Estado principal
  items: ItemType[] = [];
  isLoading = false;

  // Filtros
  searchTerm = "";
  selectedFilter = "";

  // Estado de modales
  isCreateModalOpen = false;
  isSubmitting = false;

  // Subscripciones para cleanup
  private subscriptions: Subscription[] = [];
}
```

### 2. **Carga de Datos**

```typescript
loadItems(): void {
  this.isLoading = true;

  const query: QueryDto = {
    ...(this.searchTerm && { search: this.searchTerm }),
    ...(this.selectedFilter && { filter: this.selectedFilter }),
  };

  const sub = this.service.getItems(query).subscribe({
    next: (response) => {
      this.items = response.data;
      this.isLoading = false;
    },
    error: (error) => {
      console.error('Error loading items:', error);
      this.toastService.error('Error loading items');
      this.isLoading = false;
    },
  });

  this.subscriptions.push(sub);
}
```

### 3. **Manejo de Subscripciones**

```typescript
ngOnDestroy(): void {
  this.subscriptions.forEach(sub => sub.unsubscribe());
}
```

### 4. **Métodos de Formateo**

```typescript
// Formateo de números grandes
formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Formateo de moneda
formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

// Formateo de porcentajes
getGrowthPercentage(rate: number): string {
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(1)}%`;
}
```

## 🎯 Configuración de Tablas

### 1. **Columnas Estándar**

```typescript
tableColumns: TableColumn[] = [
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    width: '250px'
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    width: '100px',
    align: 'center',
    badge: true,
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        active: '#22c55e',
        inactive: '#f59e0b',
      },
    },
    transform: (value) => this.formatStatus(value)
  },
  {
    key: 'created_at',
    label: 'Created',
    sortable: true,
    width: '150px',
    transform: (value) => this.formatDate(value)
  }
];
```

### 2. **Acciones Estándar**

```typescript
tableActions: TableAction[] = [
  {
    label: 'Edit',
    icon: 'edit',
    action: (item) => this.editItem(item),
    variant: 'primary',
  },
  {
    label: 'Delete',
    icon: 'trash-2',
    action: (item) => this.deleteItem(item),
    variant: 'danger',
  },
];
```

## 📱 Patrones Responsive

### 1. **Layouts Flexibles**

```html
<!-- Header responsive -->
<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
  <!-- Contenido -->
</div>

<!-- Grid responsive -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
  <!-- Tarjetas -->
</div>

<!-- Botones responsive -->
<app-button>
  <span class="hidden sm:inline">Texto completo</span>
  <span class="sm:hidden">Corto</span>
</app-button>
```

### 2. **Clases Condicionales**

```html
<div class="w-full sm:w-auto">
  <!-- Ancho responsive -->
  <div class="flex-col sm:flex-row">
    <!-- Dirección responsive -->
    <div class="hidden sm:inline"><!-- Ocultar/mostrar responsive --></div>
  </div>
</div>
```

## 🔍 Patrones de Filtrado

### 1. **Filtros en Header**

```html
<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
  <!-- Búsqueda (siempre visible) -->
  <app-inputsearch></app-inputsearch>

  <!-- Dropdown de filtros avanzados -->
  <app-filter-dropdown></app-filter-dropdown>

  <!-- Botones de acción -->
  <div class="flex gap-2 items-center ml-auto">
    <app-button variant="outline" (clicked)="refresh()"></app-button>
    <app-button variant="primary" (clicked)="create()"></app-button>
  </div>
</div>
```

### 2. **Dropdown de Filtros**

- Sin animaciones que afecten la usabilidad
- Posicionamiento absoluto para evitar contracción
- Altura mínima del contenedor principal
- Contador de filtros activos

## 🎨 Patrones de Estilo

### 1. **Consistencia Visual**

- Usar siempre tokens CSS del sistema
- Mantener espaciado consistente (múltiplos de 0.25rem)
- Usar bordes redondeados estándar (`rounded-card`)
- Aplicar sombras sutiles (`shadow-card`)

### 2. **Estados Interactivos**

```css
/* Hover estándar */
:hover {
  border-color: var(--color-primary);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

/* Focus estándar */
:focus {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-ring);
}

/* Active estándar */
:active {
  transform: translateY(1px);
}
```

## 🚀 Mejores Prácticas

### 1. **Performance**

- Siempre usar `ChangeDetectionStrategy.OnPush`
- Implementar `trackBy` en ngFor para listas grandes
- Limpiar subscripciones en `ngOnDestroy`
- Evitar cálculos complejos en templates

### 2. **Accesibilidad**

- Usar atributos ARIA apropiados
- Mantener orden lógico de tabulación
- Proporcionar estados focus visibles
- Incluir textos descriptivos para iconos

### 3. **UX/UI**

- Estados de carga claros
- Mensajes de error descriptivos
- Confirmaciones para acciones destructivas
- Diseño mobile-first

### 4. **Código Limpio**

- Nombres descriptivos de métodos y variables
- Comentarios para lógica compleja
- Separación de responsabilidades
- Tipado estricto con TypeScript

## 📋 Checklist de Implementación

Para nuevos módulos, verificar:

- [ ] Componente standalone con OnPush
- [ ] Uso de tokens CSS del sistema
- [ ] Estructura principal con space-y-6
- [ ] Contenedor con min-h-[600px]
- [ ] Estados: loading, empty, data
- [ ] Componentes compartidos del sistema
- [ ] Manejo correcto de subscripciones
- [ ] Diseño responsive
- [ ] Accesibilidad ARIA
- [ ] Performance optimizada

## 🔗 Referencias

- **Componentes Compartidos**: `/shared/components/`
- **Tokens CSS**: `/styles.scss`
- **Iconos**: `IconComponent` con registro en `icons.registry.ts`
- **Constantes**: `_constants.scss` en shared components

---

Este documento sirve como guía estándar para mantener consistencia en todos los módulos de la aplicación Vendix.
