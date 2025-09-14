# NgRx Store Architecture

This directory contains the NgRx store implementation for the Vendix frontend application, following a modular and scalable architecture.

## Structure

```
core/store/
├── tenant/           # Multi-tenant feature store
├── auth/            # Authentication feature store
├── base/            # Generic base store for other features
├── global.selectors.ts  # Cross-feature selectors
├── global.facade.ts     # Global facade for combined state
└── index.ts        # Main exports
```

## Features

### 1. Feature Stores
Each major feature has its own store module:
- **Tenant Store**: Manages multi-tenant configuration, branding, and environment detection
- **Auth Store**: Handles authentication state, user management, and session control
- **Base Store**: Generic store template for creating new feature stores

### 2. Centralized Selectors
Global selectors combine state from multiple features:
- `selectUserContext`: User info + tenant context
- `selectAppReady`: Application readiness state
- `selectPermissionContext`: User permissions + features
- `selectNavigationContext`: Navigation state based on permissions
- `selectBrandingContext`: Combined branding configuration

### 3. Facades
Clean API layer for components:
- **TenantFacade**: Tenant-specific operations
- **AuthFacade**: Authentication operations
- **GlobalFacade**: Cross-feature operations

## Usage Examples

### Using Feature Facades
```typescript
// In a component
constructor(
  private tenantFacade: TenantFacade,
  private authFacade: AuthFacade
) {}

ngOnInit() {
  // Subscribe to reactive state
  this.tenantFacade.branding$.subscribe(branding => {
    // Handle branding changes
  });

  this.authFacade.user$.subscribe(user => {
    // Handle user changes
  });
}
```

### Using Global Facade
```typescript
// For cross-feature state
constructor(private globalFacade: GlobalFacade) {}

ngOnInit() {
  // Get combined user and tenant context
  this.globalFacade.userContext$.subscribe(context => {
    console.log('User:', context.user);
    console.log('Organization:', context.organization);
    console.log('Store:', context.store);
  });

  // Check permissions
  if (this.globalFacade.hasPermission('admin')) {
    // Show admin features
  }
}
```

## Benefits

1. **Separation of Concerns**: Each feature manages its own state
2. **Reactive State**: Components react to state changes automatically
3. **Type Safety**: Full TypeScript support with strict typing
4. **Testability**: Easy to test selectors and effects in isolation
5. **Performance**: OnPush change detection and memoized selectors
6. **Scalability**: Easy to add new features following the same pattern

## Best Practices

1. **Use Facades**: Always inject facades instead of Store directly
2. **Subscribe in Components**: Use async pipe in templates when possible
3. **Cleanup Subscriptions**: Always unsubscribe in ngOnDestroy
4. **Memoized Selectors**: Use createSelector for complex derived state
5. **Action Naming**: Use descriptive action names (e.g., `login`, not `setUser`)
6. **Error Handling**: Handle errors in effects, not components

## SSR Compatibility

All stores are designed to work with Angular SSR:
- No direct DOM access in effects
- Platform-aware localStorage usage
- Proper handling of browser-only APIs

## Testing

Each store module includes:
- Unit tests for reducers
- Unit tests for selectors
- Unit tests for effects
- Integration tests for facades

Run tests with: `npm test`