/**
 * Platform-level payment gateway configuration interfaces (SuperAdmin).
 *
 * Mirror of the backend `MaskedGatewayView` / `UpsertGatewayDto` /
 * `TestConnectionResult` shapes, with snake_case field names to match the
 * REST contract. Sensitive secrets are NEVER returned to the frontend in
 * plaintext — `credentials_masked` only carries `pub_••••last4`-style
 * placeholders.
 *
 * Used by:
 *   - GatewayAdminService (HTTP client)
 *   - GatewayComponent (Pasarela tab)
 */

export type GatewayProcessor = 'wompi';
export type GatewayEnvironment = 'sandbox' | 'production';

/**
 * Masked credentials returned by GET /superadmin/subscriptions/gateway/:processor.
 * Each field is either null (when not configured) or a masked placeholder
 * such as `pub_••••a1b2`. NEVER the raw secret.
 */
export interface MaskedCredentials {
  public_key: string | null;
  private_key: string | null;
  events_secret: string | null;
  integrity_secret: string | null;
}

/**
 * Result of the last test_connection run, persisted alongside the credentials.
 */
export interface PlatformGatewayLastTestResult {
  ok: boolean;
  merchant_id?: string;
  message?: string;
}

/**
 * View returned by GET /superadmin/subscriptions/gateway/:processor.
 * `configured=false` when no row exists or the encrypted blob can't be parsed.
 */
export interface PlatformGatewayView {
  configured: boolean;
  processor: GatewayProcessor;
  environment: GatewayEnvironment | null;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_result: PlatformGatewayLastTestResult | null;
  credentials_masked: MaskedCredentials | null;
  updated_at: string | null;
}

/**
 * Body for PATCH /superadmin/subscriptions/gateway/:processor.
 * Required fields when configuring from scratch. The backend enforces
 * `confirm_production` when `environment='production'` and a fresh
 * successful test in the last hour before activating production.
 */
export interface UpsertGatewayDto {
  public_key: string;
  private_key: string;
  events_secret: string;
  integrity_secret: string;
  environment: GatewayEnvironment;
  is_active?: boolean;
  confirm_production?: boolean;
}

/**
 * Body for POST /superadmin/subscriptions/gateway/:processor/test.
 * All fields optional — when omitted the backend tests the stored credentials.
 */
export type TestGatewayDto = Partial<UpsertGatewayDto>;

/**
 * Response from POST /superadmin/subscriptions/gateway/:processor/test.
 */
export interface TestConnectionResult {
  ok: boolean;
  merchant_id?: string;
  message?: string;
}
