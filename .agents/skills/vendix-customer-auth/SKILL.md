---
name: vendix-customer-auth
description: >
  Customer authentication patterns for STORE_ECOMMERCE using modal login/register,
  store-scoped auth endpoints, tenant context, and legal document acceptance. Trigger:
  When implementing customer login, registration, auth modal, or ecommerce auth flows.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Implementing customer auth in e-commerce"
    - "Creating auth modal components"
    - "Customer registration flow"
---

## When to Use

- Implementing customer login or registration in `STORE_ECOMMERCE`.
- Editing the ecommerce auth modal or store ecommerce layout.
- Working with `loginCustomer`, `registerCustomer`, customer tokens, or legal document acceptance.

## Backend Endpoints

- `POST /auth/register-customer` is `@Public()`.
- `POST /auth/login-customer` is `@Public()`.
- Both collect `ip_address` and `user_agent` from the request.

Files:

- `apps/backend/src/domains/auth/auth.controller.ts`
- `apps/backend/src/domains/auth/auth.service.ts`
- `apps/backend/src/domains/auth/dto/register-customer.dto.ts`
- `apps/backend/src/domains/auth/dto/login-customer.dto.ts`

## DTO Rules

`RegisterCustomerDto` requires `email`, `first_name`, `last_name`, and `store_id`.

`password` is optional in the backend DTO. If provided, it must be at least 8 chars and contain at least one non-alphanumeric character. The current frontend modal requires a password during registration.

Optional registration fields include `phone`, `document_type`, and `document_number`. Phone allows digits plus `+ # * ( ) -` and spaces.

`LoginCustomerDto` requires `email`, `password`, and `store_id`.

## Backend Service Behavior

`registerCustomer()`:

- Finds the store by `store_id`.
- Rejects duplicate email within the store organization.
- Uses role name `customer` in lowercase.
- Generates a temporary password if backend password is omitted.
- Creates `users` with the store organization id.
- Creates `user_settings` with `app_type: 'STORE_ECOMMERCE'`.
- Creates `user_roles` and `store_users` association.
- Generates tokens with organization context.
- Emits `customer.created` and sends a store-branded welcome email.

`loginCustomer()`:

- Finds store and user by `email + organization_id`.
- Validates bcrypt password.
- Rejects suspended/archived users.
- Requires role `customer` and association in `store_users`.
- Generates tokens with `store_id: store.id`.
- Returns `updatedEnvironment: 'STORE_ECOMMERCE'`.

## Frontend Modal Pattern

Use modal auth, not redirects, for customer login/register.

Files:

- `apps/frontend/src/app/private/layouts/store-ecommerce/store-ecommerce-layout.component.ts`
- `apps/frontend/src/app/private/layouts/store-ecommerce/components/auth-modal/auth-modal.component.ts`
- `apps/frontend/src/app/core/store/auth/auth.actions.ts`
- `apps/frontend/src/app/core/store/auth/auth.facade.ts`
- `apps/frontend/src/app/core/store/auth/auth.effects.ts`
- `apps/frontend/src/app/core/store/auth/auth.reducer.ts`

The layout uses signals:

```typescript
readonly is_auth_modal_open = signal(false);
readonly auth_modal_mode = signal<'login' | 'register'>('login');

login(): void {
  this.auth_modal_mode.set('login');
  this.is_auth_modal_open.set(true);
}
```

Template binding:

```html
<app-auth-modal
  [isOpen]="is_auth_modal_open()"
  [initialMode]="auth_modal_mode()"
  [storeLogo]="store_logo()"
  [storeName]="store_name()"
  (closed)="closeAuthModal()"
/>
```

## Auth Modal Behavior

`AuthModalComponent` uses signal `input()`/`output()` APIs and signal state. It auto-closes with an `effect()` when `authFacade.isAuthenticated()` becomes true while the modal is open.

Login calls:

```typescript
const storeId = this.tenantFacade.getCurrentStoreId();
this.authFacade.loginCustomer(email, password, storeId);
```

Registration calls:

```typescript
this.authFacade.registerCustomer({
  email,
  password,
  first_name,
  last_name,
  store_id: storeId,
});
```

The modal requires pending legal documents to be accepted before registration when any are returned by the legal service.

## NgRx Auth Pattern

Dedicated customer actions exist: `loginCustomer`, `loginCustomerSuccess`, `loginCustomerFailure`, `registerCustomer`, `registerCustomerSuccess`, and `registerCustomerFailure`.

`AuthFacade.loginCustomer()` and `AuthFacade.registerCustomer()` dispatch those actions. Facade signals use `toSignal(..., { initialValue })`.

`loginSuccess$` handles customer login success too. Customer login returns `updatedEnvironment: 'STORE_ECOMMERCE'`; do not rely on it being null.

`registerCustomerSuccess` persists auth state in the reducer and shows a success toast through its effect.

## Tenant Context

The auth modal obtains `store_id` through `TenantFacade.getCurrentStoreId()`, which reads `currentStore().id` first and falls back to `domainConfig().store_id`.

Legal document APIs use `x-store-id` and live in `apps/frontend/src/app/public/ecommerce/services/legal.service.ts`.

## Rules

- Use `loginCustomer`/`registerCustomer`, not admin login/register, for ecommerce customers.
- Use signals for modal state; do not copy old plain boolean examples.
- Use lowercase `customer` when reasoning about backend role names.
- Keep frontend password validators aligned with backend password requirements when a password is collected.
- Do not redirect customers to admin routes after login.
- Keep document acceptance in the registration flow when pending legal documents exist.

## Related Skills

- `vendix-ecommerce-checkout` - Guest vs authenticated checkout boundary
- `vendix-backend-auth` - Backend auth guards and public routes
- `vendix-zoneless-signals` - Modal signal patterns
- `vendix-multi-tenant-context` - Store id resolution
