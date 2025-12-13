# Customers Module Documentation

## Overview
This module manages the Customer domain within the Store context. It follows the standard Vendix Modular Pattern for scalability and maintainability.

## Architecture & Design Patterns

### Smart-Dumb Component Pattern
- **Smart Component (Container)**: `CustomersComponent`
  - Manages state (customers list, loading status, modals)
  - Interacts with Services
  - Orchestrates child components
  - Directly integrates shared system components (e.g., `app-stats`)
- **Dumb Components (Presentational)**:
  - `CustomerListComponent`: Displays data table (Inputs: data; Outputs: events)
  - `CustomerModalComponent`: Handles forms (Inputs: isOpen, customer; Outputs: save, close)

### Service-Repository Pattern
- `CustomersService`: Encapsulates all API communication using RxJS Observables. It provides typed methods for CRUD operations and strictly returns standard interfaces for consistent data handling.

### Directory Structure
The module is organized to promote separation of concerns:

```
customers/
├── components/                 # Reusable module-specific UI components
│   ├── customer-list/          # Data Table with actions/search
│   │   └── customer-list.component.ts
│   ├── customer-modal/         # Form for Create/Edit
│   │   └── customer-modal.component.ts
│   └── index.ts               # Component exports
├── models/                     # Type definitions and interfaces
│   └── customer.model.ts       # Domain entities and DTOs
├── services/                   # Business logic and Data Access
│   └── customers.service.ts
├── customers.component.ts      # Main Entry Point (Smart Component)
└── README.md                   # This documentation
```

## Naming Conventions
- **Files**: Kebab-case (`customer-list.component.ts`)
- **Classes**: PascalCase (`CustomerListComponent`)
- **Variables/Properties**: snake_case as per project guidelines (`first_name`, `total_orders`)
- **Functions/Methods**: CamelCase (`getCustomers`, `onSave`)

## Usage
The module is lazy-loaded via the store routing module. The entry point is `CustomersComponent`.
