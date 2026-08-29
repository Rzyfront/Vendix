# Vendix Print-Formats — Playwright e2e

[print-editor-dsk P9] End-to-end specs for the print-formats Hub and Editor.

## Prerequisites

- Node.js 22.x
- Playwright (`@playwright/test`) installed in this workspace
- A running Vendix app reachable at the configured `E2E_BASE_URL`
  (defaults to `https://vendix.com`)
- Demo-account credentials injected via env vars (see below)

## Required env vars

| Variable | Description | Default |
|----------|-------------|---------|
| `E2E_BASE_URL` | Vhost to test against | `https://vendix.com` |
| `E2E_EMAIL`    | Demo-account email | — |
| `E2E_PASSWORD` | Demo-account password | — |
| `E2E_ORG_SLUG` | Organization slug (used by the legacy `.e2e.js` runner) | `roku` |

Specs short-circuit with `test.skip()` when `E2E_EMAIL` / `E2E_PASSWORD`
are missing, so a credential-less run never reports a false PASS.

## How to run

```bash
# From apps/frontend:
cd apps/frontend

# 1. Install Playwright (only needed once per machine):
npx playwright install --with-deps chromium

# 2. Run the full suite against the production vhost:
E2E_EMAIL=demo@vendix.com E2E_PASSWORD=**** \
  npx playwright test

# 3. Run only the Hub specs:
E2E_EMAIL=demo@vendix.com E2E_PASSWORD=**** \
  npx playwright test print-formats-hub

# 4. Run against staging:
E2E_BASE_URL=https://staging.vendix.com \
  E2E_EMAIL=demo@vendix.com E2E_PASSWORD=**** \
  npx playwright test
```

## Files

| File | Purpose |
|------|---------|
| `print-formats-hub.spec.ts`    | Hub load + card-grouping + click-through |
| `print-formats-editor.spec.ts` | Editor preview iframe + save round-trip |
| `fixtures/demo-account.ts`     | `DEMO_ACCOUNT` credential loader |
| `../playwright.config.ts`      | Playwright config (`baseURL`, projects, reporters) |

## Conventions

- Selectors prefer `getByRole` / `getByText` / `frameLocator` over CSS
  chains so the suite survives DOM refactors.
- Specs follow the `how-to-test` rule of thumb: at least one Happy Path;
  Sad Path / Brute-Force variants can be added under the same describe
  block in future P-rounds.
- The legacy `.e2e.js` runner (`print-formats-hub.e2e.js`) is kept for
  environments that cannot install `@playwright/test`; it uses
  `PLAYWRIGHT_MODULE` to point at a global install.
