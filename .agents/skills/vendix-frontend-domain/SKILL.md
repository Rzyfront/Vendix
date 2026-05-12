---
name: vendix-frontend-domain
description: >
  Frontend domain/app configuration patterns: AppConfigService domain detection,
  environment resolution, branding application, dynamic route selection, and cached app
  config. Trigger: When working on frontend domains.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Working on frontend domains"
---

# Vendix Frontend Domain

## Source of Truth

- `apps/frontend/src/app/core/services/app-config.service.ts`
- `apps/frontend/src/app/core/models/domain-config.interface.ts`
- `apps/frontend/src/app/core/models/environment.enum.ts`
- Route files under `apps/frontend/src/app/routes/`

## Current Model

`AppConfigService` is async and builds an `AppConfig` object through `setupConfig()` and `detectDomain()`. It does not expose the old `BehaviorSubject domain_config$$` pattern documented in legacy guidance.

It currently:

- resolves the domain through `${environment.apiUrl}/public/domains/resolve/${hostname}`
- decides effective environment from domain config plus cached authenticated user environment
- builds public/private routes dynamically
- transforms branding through `ThemeService`
- caches app config and user environment in localStorage

## DomainConfig Reality

Current config includes fields such as:

- `environment`
- `domainType`
- `organization_slug`
- `store_slug`
- `organization_id`
- `store_id`
- `store_logo_url`
- `isVendixDomain`
- `isMainVendixDomain`
- `customConfig`, which can include `branding` and `currency`

## Rules

- For new domain/app behavior, update `AppConfigService` and the route maps rather than creating duplicate domain-config services.
- Treat app environment as the primary frontend router switch.
- Keep branding resolution centralized in `ThemeService`.
- Preserve SSR/browser guards already present in `detectDomain()` and theme setup.

## Related Skills

- `vendix-app-architecture`
- `vendix-frontend-routing`
- `vendix-frontend-theme`
