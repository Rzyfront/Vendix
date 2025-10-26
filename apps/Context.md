# Contexto de la App Vendix

## Infraestructura
- Corre en Docker con contenedores: `vendix_postgres` (PostgreSQL), `vendix_backend` (NestJS), `vendix_frontend` (Angular).
- Modo desarrollo con watch hot reload activado.
- Nginx para configuración de subdominios y SSL.

## Documentación
- Carpetas `doc/` en cada proyecto (backend, frontend) con documentación específica, incluyendo ADRs, guías de arquitectura y archivos .http para pruebas de API.

## Tecnologías
- Backend: NestJS corriendo en Node.js con Prisma ORM.
- Prisma: ORM para modelado de datos, migraciones, generación automática de tipos y consultas eficientes. Configuración centralizada en `prisma/schema.prisma` y uso de clientes generados para acceso seguro a la base de datos.
- Base de datos: PostgreSQL con migraciones y seed data.
- Lenguaje: TypeScript en todo el proyecto.

## Convenciones de Código
- Funciones: CamelCase (ej. `getUserData`).
- Variables: snake_case (ej. `user_name`).
- Clases: PascalCase (ej. `UserService`).

## Arquitectura
- Modular y reutilizable.
- Multi-tenant: Soporte para dominios dinámicos, organizaciones, tiendas y usuarios.
- Herramientas específicas se crean reutilizables en carpetas `utils/`.

## Backend
- Se puede ver el build en modo watch con el comando: docker logs --tail 40 vendix_backend
- Se maneja authenticacion globales en JWT desde el app.module.ts y se expluyen rutas publicas con @Public
- Se manejan contextos automaticos globales en prisma service para organization_id y store_id y desde el app.module.ts
- Se registrar permisos para rutas granularmente con @Permissions

## Front
- Se puede ver el build en modo watch con el comando: docker logs --tail 40 vendix_frontend
- Se maneja un punto e entrada que resuelve el dominio para configurar y decidir que vista mostrar.
- Se setea la configuracion de branding resuelta por el dominio.
- Se usa tokens para mantener un estandar de estilos generales en la app @apps/frontend/src/styles.scss.
- Se usan componentes reutilizables para la construccion de vistar y componentes llamados desde el index.ts de @apps/frontend/src/app/shared/components.
- Se usa un gestor de estados global centralizado.
- Se usa un guard para direccionar a layout de aplicacion especificas por rol.
- Se usa Lucide para los iconos, con un componente Icon para modularidad.

### Patrón Estándar de Desarrollo de Módulos

Los módulos del frontend siguen una estructura estandarizada para mantener consistencia y facilitar el desarrollo:

#### Estructura de Carpetas
```
modules/
└── [nombre-modulo]/
    ├── [nombre-modulo].component.ts      # Componente principal
    ├── [nombre-modulo].component.html   # Template (opcional, puede ser inline)
    ├── [nombre-modulo].component.css    # Estilos específicos del componente
    ├── [nombre-modulo].routes.ts        # Definición de rutas (opcional)
    ├── index.ts                          # Exportaciones públicas del módulo
    ├── components/                       # Componentes específicos del módulo
    │   ├── index.ts                      # Exportación de componentes
    │   ├── [nombre]-stats.component.ts   # Componente de estadísticas
    │   ├── [nombre]-create-modal.component.ts
    │   ├── [nombre]-edit-modal.component.ts
    │   ├── [nombre]-empty-state.component.ts
    │   └── [nombre]-pagination.component.ts
    ├── services/                         # Lógica de negocio y API
    │   └── [nombre].service.ts
    └── interfaces/                       # Tipos y contratos de datos
        └── [nombre].interface.ts
```

#### Componentes Principales
- **Componente Principal**: Gestiona el estado general, carga de datos y coordinación
- **Componentes de Estadísticas**: Muestran métricas relevantes del módulo
- **Componentes Modales**: Para creación y edición de entidades
- **Componente Empty State**: Mensaje cuando no hay datos
- **Componente Paginación**: Manejo de paginación de resultados

#### Servicios
- **Comunicación API**: Centralizan todas las llamadas HTTP al backend
- **Gestión de Estado**: Manejan estados de carga con BehaviorSubject
- **Mapeo de Datos**: Transforman respuestas de API a interfaces del frontend
- **Manejo de Errores**: Implementan catchError y manejo consistente de errores

#### Interfaces
- **Entidades Principales**: Definen la estructura de datos principales
- **DTOs**: Para operaciones de creación y actualización
- **Query DTOs**: Para filtros y parámetros de búsqueda
- **Respuestas Paginadas**: Estructura estándar para respuestas con paginación
- **Estadísticas**: Estructura para métricas del dashboard

#### Patrones de Implementación
- **Standalone Components**: Todos los componentes son standalone con imports explícitos
- **Reactive Forms**: Uso de FormBuilder para formularios con validación
- **Observables**: Manejo de operaciones asíncronas con RxJS
- **Desuscripción**: Gestión propera de suscripciones con ngOnDestroy
- **Componentes Reutilizables**: Uso extensivo de componentes compartidos (TableComponent, ButtonComponent, etc.)

#### Estándares de Código
- **Nomenclatura**: Prefijo consistente para componentes del módulo
- **Exportaciones**: Uso de index.ts para exportaciones limpias
- **Tipado Fuerte**: Uso de TypeScript para todas las interfaces
- **Manejo de Carga**: Estados de isLoading para mejor UX
- **Notificaciones**: Uso de ToastService para feedback al usuario

### Patrón Estándar de Desarrollo y Uso de Componentes

Los componentes compartidos siguen una arquitectura consistente para garantizar reutilización y mantenibilidad:

#### Estructura de Componentes Compartidos
```
shared/components/
├── index.ts                          # Exportación centralizada de componentes y tipos
└── [nombre-componente]/
    ├── [nombre-componente].component.ts
    ├── [nombre-componente].component.html (opcional)
    ├── [nombre-componente].component.scss (opcional)
    └── [nombre-componente].service.ts (si aplica)
```

#### Principios de Diseño de Componentes

**1. Componentes Standalone**
- Todos los componentes son standalone con imports explícitos
- Sin dependencias de módulos Angular tradicionales
- Mejor tree-shaking y rendimiento

**2. Tipado Fuerte**
- Definición de tipos exportados para configuración
- Interfaces claras para props y eventos
- Uso de genéricos cuando es aplicable

**3. Configuración Flexible**
- Props opcionales con valores por defecto sensibles
- Múltiples variantes (size, variant, type)
- Soporte para clases personalizadas

#### Componentes Principales y Patrones

**ButtonComponent**
- Variantes: primary, secondary, outline, ghost, danger
- Tamaños: sm, md, lg
- Estados: loading, disabled
- Slots para iconos y contenido personalizado

**TableComponent**
- Configuración mediante interfaces TableColumn y TableAction
- Soporte para sorting, paginación, acciones personalizadas
- Templates para celdas personalizadas
- Badges con configuración flexible

**ModalComponent**
- Tamaños predefinidos: sm, md, lg
- Control de backdrop y escape key
- Slots para header, content y footer
- Gestión automática de scroll del body

**InputComponent / InputsearchComponent**
- Implementación de ControlValueAccessor
- Validación integrada con Reactive Forms
- Estados de error y ayuda
- Soporte para iconos prefix/suffix

**IconComponent**
- Iconos SVG inline sin dependencias externas
- Tamaño y color configurables
- Catálogo extenso de iconos comunes

#### Servicios Compartidos

**ToastService**
- Sistema de notificaciones no intrusivo
- Variantes: success, error, warning, info
- Gestión automática de duración y animaciones
- API simple con métodos helpers

**DialogService**
- Creación dinámica de modales de confirmación
- Promises para manejo asíncrono
- Configuración flexible de textos y variantes

#### Patrones de Implementación

**1. ControlValueAccessor**
- Componentes de formulario implementan esta interfaz
- Integración transparente con Reactive Forms
- Manejo propero de estado y validación

**2. Emisión de Eventos**
- Nomenclatura consistente: clicked, change, focus, blur
- Uso de EventEmitter para comunicación padre-hijo
- Eventos tipados para mejor autocompletado

**3. Gestión de Clases CSS**
- Métodos getter para clases dinámicas
- Composición de clases base + estado + tamaño
- Soporte para clases personalizadas

**4. Slots y Proyección de Contenido**
- Uso de ng-content para contenido flexible
- Slots nombrados para estructuras complejas
- Contenido por defecto con override opcional

#### Estándares de Nomenclatura

**Selectores**
- Prefijo `app-` para todos los componentes
- Nombres descriptivos en kebab-case
- Ej: `app-button`, `app-inputsearch`, `app-table`

**Tipos Exportados**
- Nombres descriptivos con sufijo de tipo
- Ej: `ButtonVariant`, `TableSize`, `ModalSize`
- Agrupación lógica por componente

**Eventos**
- Verbos en pasado para eventos completados
- Ej: `clicked`, `changed`, `opened`, `closed`
- Sustantivos para eventos de estado: `focus`, `blur`

#### Uso en Módulos

**Importación**
```typescript
import {
  ButtonComponent,
  TableComponent,
  ModalComponent,
  ButtonVariant,
  TableColumn
} from '../../../../shared/components/index';
```

**Configuración Típica**
```typescript
// Table configuration
tableColumns: TableColumn[] = [
  {
    key: 'name',
    label: 'Nombre',
    sortable: true,
    transform: (value) => value.toUpperCase()
  }
];

// Button usage
<app-button
  variant="primary"
  size="sm"
  (clicked)="handleClick()"
  [loading]="isLoading">
  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
  Nuevo
</app-button>
```

#### Consideraciones de Accesibilidad

- Atributos ARIA en componentes interactivos
- Navegación por teclado en modales y tablas
- Contraste de colores según WCAG
- Roles semánticos apropiados

#### Rendimiento y Optimización

- ChangeDetectionStrategy.OnPush donde aplica
- Evitar cálculos complejos en templates
- Uso de trackBy en listas grandes
- Lazy loading de componentes pesados