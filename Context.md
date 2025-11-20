# Vendix App Context

## Rules !!CRITICAL!!

### Variable Naming Conventions - ABSOLUTE PRIORITY
The following variable naming conventions are **MANDATORY** and **NON-NEGOTIABLE**:

- **Variables**: MUST use snake_case (e.g., `user_name`, `order_total`, `is_active`)
- **Functions**: MUST use CamelCase (e.g., `getUserData()`, `calculateOrderTotal()`)
- **Classes**: MUST use PascalCase (e.g., `UserService`, `OrderService`)

**SUPER IMPORTANT!!**: Variable naming consistency is CRITICAL for:
- Code readability and maintainability
- Team collaboration efficiency
- Automated code quality tools
- Preventing naming conflicts and bugs
- Ensuring proper TypeScript type inference

**VIOLATIONS of variable naming conventions are considered CRITICAL issues and MUST be fixed immediately.**

### Development Principles

- Always use Task tool or multi-task tools available for complex operations
- Prioritize code consistency over individual preferences
- Follow established patterns strictly
- Maintain high code quality standards

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

### **ABSOLUTELY MANDATORY - Variable Naming (CRITICAL PRIORITY!!)**

- **Variables**: MUST be snake_case (e.g., `user_name`, `order_total`, `product_list`) - **NO EXCEPTIONS!**
- **Functions**: MUST be CamelCase (e.g., `getUserData()`, `calculateOrderTotal()`) - **NO EXCEPTIONS!**
- **Classes**: MUST be PascalCase (e.g., `UserService`, `OrderService`) - **NO EXCEPTIONS!**

**REMINDER**: Variable naming conventions are CRITICAL for project success. Violations will be immediately flagged and must be corrected. This affects code maintainability, team collaboration, and overall project quality.

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

## Mandatory Requirements !!NON-NEGOTIABLE!!

### **ALWAYS USE TASK TOOLS!!**
For all complex, multi-step, or exploration tasks, you **MUST** use:
- `Task tool` with specialized agents (Explore, Plan, general-purpose)
- Available multi-task tools for parallel operations
- Specialized tools before resorting to basic commands

### **VARIABLE NAMING IS ABSOLUTE PRIORITY!!**
You **MUST ALWAYS** respect variable naming conventions:
- **Variables**: `snake_case` (e.g., `user_data`, `order_total`)
- **Functions**: `CamelCase` (e.g., `getUserData()`, `processOrder()`)
- **Classes**: `PascalCase` (e.g., `UserService`, `OrderService`)

**IMPORTANT!!!** This is not optional:
- Always double-check variable names before writing code
- Never compromise on naming conventions for any reason
- Immediately fix any naming violations
- Reinforce these conventions in every interaction

### **ENFORCEMENT POLICY**
- Variable naming violations are treated as **CRITICAL bugs**
- Failure to use Task tools when appropriate is **unacceptable**
- Consistency and quality standards are **non-negotiable**
- These rules apply to **ALL** code changes, no exceptions

**REMEMBER**: Code quality and consistency directly impact project success, team productivity, and long-term maintainability.
