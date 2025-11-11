# Store Persistence

This module provides automatic state persistence for the NgRx store, allowing critical application state to be maintained across browser sessions.

## Features

- **SSR Compatible**: Safely handles server-side rendering
- **Selective Persistence**: Only persists specified state properties
- **Security Conscious**: Doesn't persist sensitive data like tokens
- **Error Handling**: Graceful fallbacks when localStorage is unavailable
- **Type Safe**: Full TypeScript support

## Configuration

The persistence system is configured in `persistence.ts`:

```typescript
const DEFAULT_CONFIG: PersistenceConfig = {
  tenant: {
    enabled: true,
    keys: ['domainConfig', 'tenantConfig', 'environment']
  },
  auth: {
    enabled: true,
    keys: ['user'] // Don't persist tokens for security
  }
};
```

## What Gets Persisted

### Tenant State
- `domainConfig`: Domain resolution information
- `tenantConfig`: Tenant configuration and branding
- `environment`: Current application environment

### Auth State
- `user`: User information (but not tokens)

### What Doesn't Get Persisted
- Authentication tokens (for security)
- Loading states
- Error states
- Temporary UI state

## Usage

The persistence system works automatically once configured. State is:

1. **Saved**: Automatically when state changes
2. **Loaded**: On application startup
3. **Hydrated**: Initial state is restored from localStorage

## Manual Control

You can also manually control persistence:

```typescript
constructor(private persistenceService: StorePersistenceService) {}

// Save specific state
persistenceService.saveState('custom_key', { data: 'value' });

// Load specific state
const data = persistenceService.loadState('custom_key');

// Clear all persisted state
persistenceService.clearAllState();
```

## Storage Keys

- `vendix_tenant_state`: Tenant configuration
- `vendix_auth_state`: User authentication state

## Security Considerations

- Tokens are never persisted to prevent security issues
- Sensitive user data is not persisted
- localStorage is cleared on logout
- SSR-safe implementation prevents server-side access

## Browser Support

- Modern browsers with localStorage support
- Graceful degradation when localStorage is unavailable
- No impact on server-side rendering

## Troubleshooting

### State Not Persisting
- Check browser developer tools for localStorage entries
- Verify the state keys are in the configuration
- Ensure the application is running in a browser environment

### State Not Loading
- Check for localStorage errors in console
- Verify the storage keys exist
- Check that SSR protection is working correctly

### Performance Issues
- Only critical state is persisted
- Persistence happens asynchronously
- State is compressed before storage