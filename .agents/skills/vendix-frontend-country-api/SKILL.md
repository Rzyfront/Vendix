---
name: vendix-frontend-country-api
description: >
  Frontend country/department/city handling patterns, including the two active CountryService
  implementations and the Colombia-only department/city API flow. Trigger: When building
  country, timezone, department, or city selectors in frontend forms.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Working with country, timezone, department, or city selectors in frontend"
---

# Vendix Frontend Country API

## Important Reality

There are two different `CountryService` classes in the frontend:

1. `apps/frontend/src/app/services/country.service.ts`
2. `apps/frontend/src/app/core/services/country.service.ts`

Do not assume they are interchangeable.

## Active Colombia Department/City Flow

The non-core service at `src/app/services/country.service.ts` currently owns:

- static countries
- static country-specific timezones
- Colombia department fetch from `https://api-colombia.com/api/v1/Department`
- city fetch by department id

This is the service used by current country -> department -> city selector flows.

## Core Service

The core service at `src/app/core/services/country.service.ts` is a separate static/observable service for broader country/timezone lists and does not provide the same Colombia department/city API contract.

## Rules

- If your form needs Colombia departments/cities, use the non-core service explicitly.
- If your flow only needs static countries/timezones via observables, the core service may be the better fit.
- Be explicit in imports to avoid silently pulling the wrong `CountryService`.
- For OnPush/zoneless components, prefer signal-driven or properly patched async form state instead of legacy `ChangeDetectorRef` habits unless the surrounding component already uses them.

## Related Skills

- `vendix-angular-forms`
- `vendix-zoneless-signals`
- `vendix-frontend-component`
