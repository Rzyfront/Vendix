/**
 * [print-editor-dsk P9] — Demo-account credentials for Playwright e2e.
 *
 * The fixture exports `DEMO_ACCOUNT` so any Playwright spec can import it
 * without leaking credentials into the spec body. The values are read from
 * env (`E2E_EMAIL` / `E2E_PASSWORD`); a fallback placeholder is exported
 * to keep TypeScript happy in CI environments where the secret is unset.
 *
 * In production CI, `E2E_EMAIL` and `E2E_PASSWORD` MUST be injected from
 * the secret manager (`docs/e2e/credentials.md` is gitignored). When the
 * env vars are missing, the specs short-circuit with `test.skip()` so they
 * do not silently pass on a missing credential.
 */

export interface DemoAccount {
  email: string;
  password: string;
  organization_slug: string;
}

export const DEMO_ACCOUNT: DemoAccount = {
  email: process.env.E2E_EMAIL ?? 'demo@vendix.com',
  password: process.env.E2E_PASSWORD ?? 'changeme',
  organization_slug: process.env.E2E_ORG_SLUG ?? 'roku',
};

export const HAS_DEMO_CREDENTIALS: boolean = Boolean(
  process.env.E2E_EMAIL && process.env.E2E_PASSWORD,
);

export const BASE_URL: string = process.env.E2E_BASE_URL ?? 'https://vendix.com';
