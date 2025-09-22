# Vendix Multi-Tenant Layouts Guide

This document is a guide for implementing the **multi-tenant layouts and views** for the Vendix system (POS + eCommerce).  
The goal is to create a **clean, modular, role-based architecture** that works for SaaS multi-tenant applications.

---

## 1. Global Principles
- **Framework**: Angular (with Angular Router).  
- **UI System**: Reusable Angular components for sidebar, topbar, footer.  
- **Routing Strategy**:
  - Public routes → Storefront (eCommerce)
  - Private routes → Admin / POS
- **Tenant White Label**: Layouts should dynamically load logo, colors, and domain based on the `tenant` (store) configuration.
- **RBAC**: Use role-based access control to render menus and restrict pages.

---

## 2. Layouts

### 2.1 Auth Layout
- Purpose: Minimal UI for login, register, forgot password.
- Components:
  - `AuthLayout` (Angular component with `<router-outlet>`)
  - `LoginPage`, `RegisterPage`, `ForgotPasswordPage` (Angular components)
- Features:
  - Clean design
  - Tenant branding applied (logo, colors)

---

### 2.2 Admin Layout (Tenant Owner / Global Admin)
- Purpose: Control panel for managing stores, products, users, reports.
- Components:
  - `AdminLayout` (Angular component with Sidebar + Topbar and `<router-outlet>`)
- Key Views:
  - Dashboard (sales, inventory, clients overview)
  - Users & Roles
  - Audit Logs
  - Store Management (logo, domain, colors, settings)

---

### 2.3 POS Layout (Point of Sale)
- Purpose: Fast and responsive UI for physical sales.
- Components:
  - `POSLayout` (Angular component with `<router-outlet>`)
  - Quick access buttons (Angular components)
- Key Views:
  - Register Sale (touch/tablet friendly)
  - Product Catalog (search, scan, add)
  - Customers
  - Orders (track and print receipts)
- Features:
  - Offline mode support
  - Quick keyboard shortcuts

---

### 2.4 Storefront Layout (Public eCommerce)
- Purpose: Public-facing shop.
- Components:
  - `StorefrontLayout` (Angular component with Header + Footer + Content and `<router-outlet>`)
- Key Views:
  - Home Page
  - Product List
  - Product Detail
  - Cart
  - Checkout
  - Reviews
  - Order Tracking
- Features:
  - SEO friendly
  - Mobile-first design

---

### 2.5 Super Admin Layout (Platform Owner)
- Purpose: Manage tenants and SaaS billing.
- Components:
  - `SuperAdminLayout` (Angular component with `<router-outlet>`)
- Key Views:
  - Tenant List
  - Billing & Plans
  - Global Analytics
  - Security / Audit

---

## 3. Context Rules
- **Tenant Context**: load branding and settings from `store_id` or `organization_id`.
- **Role Context**: menus and routes change depending on the user role (Admin, Seller, Client).
- **Channel Context**: POS vs. Storefront determined by route namespace (`/pos` vs `/shop`).
- **Device Context**: optimize UI for desktop (Admin/POS) and mobile (Storefront).

---

## 4. Suggested Folder Structure
/src
/layouts
AuthLayout
AdminLayout
POSLayout
StorefrontLayout
SuperAdminLayout
/views
/auth
/admin
/pos
/storefront
/superadmin
/components
/context (tenant, role, channel)

---

## 5. Next Steps for Copilot
1. Generate base layout components using `ng generate component layouts/AuthLayout` with router outlets.
2. Implement role-based route guards using Angular's `CanActivate` interface.
3. Apply tenant branding dynamically using Angular services and CSS variables.
4. Create placeholder views for each layout using `ng generate component views/auth/LoginPage` (empty pages).
5. Scaffold sidebar and navigation menus with role-based visibility using Angular directives like `*ngIf`.

---