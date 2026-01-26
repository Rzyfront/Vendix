---
name: vendix-customer-auth
description: >
  Customer authentication patterns for STORE_ECOMMERCE app using modal-based login/register.
  Trigger: When implementing customer login, registration, or auth modal in e-commerce frontend.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: frontend
  auto_invoke:
    - action: "Implementing customer auth in e-commerce"
    - action: "Creating auth modal components"
    - action: "Customer registration flow"
---

## When to Use

- Implementing customer login/registration in STORE_ECOMMERCE
- Creating auth modals that don't redirect
- Working with customer-specific auth flows
- Integrating TenantFacade with auth

## Critical Patterns

### 1. Modal-Based Auth (No Redirect)

Customers authenticate via modal using dedicated customer-only methods:

```typescript
// store-ecommerce-layout.component.ts
@Component({...})
export class StoreEcommerceLayoutComponent {
  is_auth_modal_open = false;
  auth_modal_mode: 'login' | 'register' = 'login';

  login(): void {
    this.auth_modal_mode = 'login';
    this.is_auth_modal_open = true;
    this.show_user_menu = false;
  }

  register(): void {
    this.auth_modal_mode = 'register';
    this.is_auth_modal_open = true;
    this.show_user_menu = false;
  }
}
```

### 2. Dedicated Customer Auth Methods

Always use `loginCustomer` and `registerCustomer` for e-commerce, which require `store_id`:

```typescript
onSubmit(): void {
  const storeId = this.tenantFacade.getCurrentStoreId();

  if (this.isLogin) {
    // Dedicated customer login
    this.authFacade.loginCustomer(email, password, storeId);
  } else {
    // Dedicated customer registration
    this.authFacade.registerCustomer({
      ...this.authForm.value,
      store_id: storeId,
    });
  }
}
```

### 3. Backend Symmetry

Customer auth has its own dedicated endpoints to avoid admin-logic conflicts:

- `POST /api/auth/register-customer`
- `POST /api/auth/login-customer` (Requires store_id)

### 4. Password Requirements (Backend Strictness)

The backend `RegisterCustomerDto` requires:

- **Min 8 characters**
- **At least one special character** (e.g., `@`, `#`, `!`)

Ensure your frontend validators match:

```typescript
password: [
  "",
  [
    Validators.required,
    Validators.minLength(8),
    Validators.pattern(/.*[^A-Za-z0-9].*/),
  ],
];
```

### 4. loginSuccess$ Effect - No Redirect for E-commerce

The effect already handles this:

```typescript
// auth.effects.ts
loginSuccess$ = createEffect(() =>
  this.actions$.pipe(
    ofType(AuthActions.loginSuccess),
    tap(({ message, updated_environment }) => {
      if (message) this.toast.success(message);

      // For customers, updated_environment is null
      // So we just return without redirecting
      if (!currentConfig || !updated_environment) {
        return; // Modal closes via isAuthenticated$ subscription
      }
      // ... admin redirect logic
    }),
  ),
);
```

### 5. Dropdown Close Pattern (No Overlay)

Use `@HostListener` instead of overlay divs:

```typescript
@HostListener('document:click', ['$event'])
onClickOutside(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const container = document.querySelector('.user-menu-container');
  if (this.show_user_menu && container && !container.contains(target)) {
    this.show_user_menu = false;
  }
}

@HostListener('document:keydown.escape')
onEscapeKey(): void {
  if (this.show_user_menu) {
    this.show_user_menu = false;
  }
}
```

## Data Flow

```
User clicks Login
  -> Opens AuthModal (is_auth_modal_open = true)
  -> User submits form
  -> AuthFacade.login() dispatches action
  -> auth.effects.ts: login$ calls API
  -> API returns tokens + user
  -> auth.reducer.ts: loginSuccess sets is_authenticated = true
  -> auth.effects.ts: loginSuccess$ shows toast, returns (no redirect)
  -> AuthModal observes isAuthenticated$ = true
  -> AuthModal.onClose() fires
  -> User stays on current page, authenticated
```

## Backend Requirements

Customer registration endpoint should:

1. Create user with role `CUSTOMER`
2. Create `UserSettings` with `config.app: 'STORE_ECOMMERCE'`
3. Associate user with store via `store_users` table
4. Return tokens for immediate login

## Files Reference

| File                                  | Purpose                    |
| ------------------------------------- | -------------------------- |
| `store-ecommerce-layout.component.ts` | Layout with modal triggers |
| `auth-modal/auth-modal.component.ts`  | Modal component            |
| `auth.effects.ts`                     | loginSuccess$ effect       |
| `auth.reducer.ts`                     | State management           |
| `auth.facade.ts`                      | Public API for auth        |
| `tenant.facade.ts`                    | Store/domain context       |

## Commands

```bash
# Generate auth modal component
ng g c private/layouts/store-ecommerce/components/auth-modal --standalone

# Check auth state
localStorage.getItem('vendix_auth_state')
```
