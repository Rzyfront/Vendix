# Organization Users Module Documentation

## Overview
This module manages the User domain within the Organization context. It follows the standard Vendix Modular Pattern for scalability and maintainability.

## Architecture & Design Patterns

### Smart-Dumb Component Pattern
- **Smart Component (Container)**: `UsersComponent`
  - Manages state (users list, stats calculations, loading status, modals)
  - Interacts with Services (`UsersService`, `UserStatsService`)
  - Orchestrates child components
  - Directly integrates shared system components (e.g., `app-stats`)

- **Dumb Components (Presentational)**:
  - `UserCardComponent`: Displays individual user details in card view (Inputs: user; Outputs: actions)
  - `UserEmptyStateComponent`: Displays placeholder when no data exists (Inputs: title, description; Outputs: action)
  - `UserCreateModalComponent`: Handles user creation form (Inputs: isOpen; Outputs: onClose, onUserCreated)
  - `UserEditModalComponent`: Handles user editing form (Inputs: user, isOpen; Outputs: onClose, onUserUpdated)
  - `UserConfigModalComponent`: Handles additional user configuration (Inputs: user, isOpen; Outputs: onClose)

### Service-Repository Pattern
- `UsersService`: Encapsulates all API communication using RxJS Observables. It provides typed methods for CRUD operations and strictly returns standard interfaces for consistent data handling.
- `UserStatsService`: specialized service for calculating user statistics from the user list.

### Directory Structure
The module is organized to promote separation of concerns:

```
users/
├── components/                 # Reusable module-specific UI components
│   ├── user-card.component.ts      # Card view item
│   ├── user-create-modal.component.ts
│   ├── user-edit-modal.component.ts
│   ├── user-config-modal.component.ts
│   ├── user-empty-state.component.ts
│   └── index.ts               # Component exports
├── interfaces/                 # Type definitions and interfaces
│   └── user.interface.ts       # Domain entities and DTOs
├── services/                   # Business logic and Data Access
│   ├── users.service.ts
│   └── user-stats.service.ts
├── users.component.ts          # Main Entry Point (Smart Component)
└── README.md                   # This documentation
```

## Naming Conventions
- **Files**: Kebab-case (`user-card.component.ts`)
- **Classes**: PascalCase (`UserCardComponent`)
- **Variables/Properties**: snake_case as per project guidelines (`first_name`, `total_usuarios`)
- **Functions/Methods**: CamelCase (`getUsers`, `onUserCreated`)

## Usage
The module is lazy-loaded via the organization routing module. The entry point is `UsersComponent` at `/private/organization/users`.
