# Vendix App Context

## Infrastructure

- Runs in Docker with containers: `vendix_postgres` (PostgreSQL), `vendix_backend` (NestJS), `vendix_frontend` (Angular).
- Development mode with watch hot reload enabled.
- Nginx for subdomain configuration and SSL.

## Documentation

- `doc/` folders in each project (backend, frontend) with specific documentation, including ADRs, architecture guides, and .http files for API testing.
- **API Testing with Bruno**: Local collection in `bruno/` for endpoint testing with centralized base URL configuration `api.vendix.com` and available health check.

## Technologies

- Backend: NestJS running on Node.js with Prisma ORM.
- Prisma: ORM for data modeling, migrations, automatic type generation, and efficient queries. Centralized configuration in `prisma/schema.prisma` and use of generated clients for secure database access.
- Database: PostgreSQL with migrations and seed data.
- Language: TypeScript throughout the project.

## Code Conventions !!IMPORTANT!!

- Functions: CamelCase (e.g., `getUserData`).
- Variables: snake_case (e.g., `user_name`).
- Classes: PascalCase (e.g., `UserService`).

## Architecture

- Modular and reusable.
- Multi-tenant: Support for dynamic domains, organizations, stores, and users.
- Specific tools are created reusable in `utils/` folders.

## Backend

- You can watch the build in watch mode with the command: docker logs --tail 40 vendix_backend
- Global JWT authentication is handled from app.module.ts and public routes are exposed with @Public
- Automatic global contexts are handled in prisma service for organization_id and store_id and from app.module.ts
- Permissions are registered for routes granularly with @Permissions

## Frontend

- You can watch the build in watch mode with the command: docker logs --tail 40 vendix_frontend
- An entry point is managed that resolves the domain to configure and decide which view to display.
- Branding configuration resolved by the domain is set.
- Tokens are used to maintain a standard of general styles in the app @apps/frontend/src/styles.scss.
- Reusable components are used for building views and components called from the index.ts of @apps/frontend/src/app/shared/components.
- A centralized global state manager is used.
- A guard is used to direct to specific application layouts by role.
- Lucide is used for icons, with an Icon component for modularity.

### Standard Module Development Pattern

Frontend modules follow a standardized structure to maintain consistency and facilitate development:

#### Folder Structure

```
modules/
└── [module-name]/
    ├── [module-name].component.ts      # Main component
    ├── [module-name].component.html   # Template (optional, can be inline)
    ├── [module-name].component.css    # Component-specific styles
    ├── [module-name].routes.ts        # Route definition (optional)
    ├── index.ts                          # Public module exports
    ├── components/                       # Module-specific components
    │   ├── index.ts                      # Component exports
    │   ├── [name]-stats.component.ts   # Statistics component
    │   ├── [name]-create-modal.component.ts
    │   ├── [name]-edit-modal.component.ts
    │   ├── [name]-empty-state.component.ts
    │   └── [name]-pagination.component.ts
    ├── services/                         # Business logic and API
    │   └── [name].service.ts
    └── interfaces/                       # Types and data contracts
        └── [name].interface.ts
```

#### Main Components

- **Main Component**: Manages overall state, data loading, and coordination
- **Statistics Components**: Display relevant module metrics
- **Modal Components**: For entity creation and editing
- **Empty State Component**: Message when there is no data
- **Pagination Component**: Handle result pagination

#### Services

- **API Communication**: Centralize all HTTP calls to the backend
- **State Management**: Handle loading states with BehaviorSubject
- **Data Mapping**: Transform API responses to frontend interfaces
- **Error Handling**: Implement catchError and consistent error handling

#### Interfaces

- **Main Entities**: Define main data structure
- **DTOs**: For creation and update operations
- **Query DTOs**: For filters and search parameters
- **Paginated Responses**: Standard structure for paginated responses
- **Statistics**: Structure for dashboard metrics

#### Implementation Patterns

- **Standalone Components**: All components are standalone with explicit imports
- **Reactive Forms**: Use FormBuilder for forms with validation
- **Observables**: Handle async operations with RxJS
- **Unsubscription**: Proper subscription management with ngOnDestroy
- **Reusable Components**: Extensive use of shared components (TableComponent, ButtonComponent, etc.)

#### Code Standards

- **Nomenclature**: Consistent prefix for module components
- **Exports**: Use index.ts for clean exports
- **Strong Typing**: Use TypeScript for all interfaces
- **Loading Handling**: isLoading states for better UX
- **Notifications**: Use ToastService for user feedback

### Standard Component Development and Usage Pattern

Shared components follow a consistent architecture to ensure reusability and maintainability:

#### Shared Components Structure

```
shared/components/
├── index.ts                          # Centralized export of components and types
└── [component-name]/
    ├── [component-name].component.ts
    ├── [component-name].component.html (optional)
    ├── [component-name].component.scss (optional)
    └── [component-name].service.ts (if applicable)
```

#### Component Design Principles

**1. Standalone Components**

- All components are standalone with explicit imports
- No dependencies on traditional Angular modules
- Better tree-shaking and performance

**2. Strong Typing**

- Exported type definitions for configuration
- Clear interfaces for props and events
- Use of generics when applicable

**3. Flexible Configuration**

- Optional props with sensible default values
- Multiple variants (size, variant, type)
- Support for custom classes

#### Main Components and Patterns

**ButtonComponent**

- Variants: primary, secondary, outline, ghost, danger
- Sizes: sm, md, lg
- States: loading, disabled
- Slots for icons and custom content

**TableComponent**

- Configuration via TableColumn and TableAction interfaces
- Support for sorting, pagination, custom actions
- Templates for custom cells
- Badges with flexible configuration

**ModalComponent**

- Predefined sizes: sm, md, lg
- Backdrop and escape key control
- Slots for header, content, and footer
- Automatic body scroll management

**InputComponent / InputsearchComponent**

- ControlValueAccessor implementation
- Integrated validation with Reactive Forms
- Error and help states
- Support for prefix/suffix icons

**IconComponent**

- Inline SVG icons without external dependencies
- Configurable size and color
- Extensive catalog of common icons

#### Shared Services

**ToastService**

- Non-intrusive notification system
- Variants: success, error, warning, info
- Automatic duration and animation management
- Simple API with helper methods

**DialogService**

- Dynamic creation of confirmation modals
- Promises for async handling
- Flexible configuration of texts and variants

#### Implementation Patterns

**1. ControlValueAccessor**

- Form components implement this interface
- Transparent integration with Reactive Forms
- Proper state and validation handling

**2. Event Emission**

- Consistent nomenclature: clicked, change, focus, blur
- Use of EventEmitter for parent-child communication
- Typed events for better autocompletion

**3. CSS Class Management**

- Getter methods for dynamic classes
- Composition of base + state + size classes
- Support for custom classes

**4. Slots and Content Projection**

- Use of ng-content for flexible content
- Named slots for complex structures
- Default content with optional override

#### Nomenclature Standards

**Selectors**

- `app-` prefix for all components
- Descriptive names in kebab-case
- Example: `app-button`, `app-inputsearch`, `app-table`

**Exported Types**

- Descriptive names with type suffix
- Example: `ButtonVariant`, `TableSize`, `ModalSize`
- Logical grouping by component

**Events**

- Past tense verbs for completed events
- Example: `clicked`, `changed`, `opened`, `closed`
- Nouns for state events: `focus`, `blur`

#### Usage in Modules

**Import**

```typescript
import {
  ButtonComponent,
  TableComponent,
  ModalComponent,
  ButtonVariant,
  TableColumn,
} from "../../../../shared/components/index";
```

**Typical Configuration**

```typescript
// Table configuration
tableColumns: TableColumn[] = [
  {
    key: 'name',
    label: 'Name',
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
  New
</app-button>
```

#### Accessibility Considerations

- ARIA attributes on interactive components
- Keyboard navigation in modals and tables
- Color contrast according to WCAG
- Appropriate semantic roles

#### Performance and Optimization

- ChangeDetectionStrategy.OnPush where applicable
- Avoid complex calculations in templates
- Use trackBy on large lists
- Lazy loading of heavy components
