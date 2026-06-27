import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Public DTO for creating a PQR (Petición / Queja / Reclamo).
 *
 * Used by:
 * - Public form (no auth, from any store's home page)
 * - Authenticated customers (via the same endpoint, with user context)
 *
 * Validation enforced via class-validator — the backend returns 400
 * with field-level error messages on failure.
 */
export class CreatePqrPublicDto {
  @IsIn(['PETITION', 'COMPLAINT', 'CLAIM'])
  pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM';

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(255)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(5000)
  description: string;

  /**
   * Optional urgency hint from the requester. Allowed values are
   * `P1` through `P4` — `P0` is intentionally excluded so external
   * requesters (storefront visitors, store-admins creating tickets)
   * cannot self-assign the highest criticality tier, which is
   * reserved for the support team's own triage based on impact.
   *
   * Defaults to `P3` (medium) when omitted.
   */
  @IsOptional()
  @IsIn(['P1', 'P2', 'P3', 'P4'])
  priority?: 'P1' | 'P2' | 'P3' | 'P4';

  /**
   * Optional organization ID the PQR belongs to. When the requester is
   * an authenticated store-admin / org-admin, the backend resolves this
   * from the session; when omitted (anonymous storefront visitor), the
   * ticket is parked under the platform org `orgVendix` (legacy default).
   *
   * Storing it on the row is what enables the org-admin PQR oversight
   * view (`/api/admin/support/pqr`) to filter by `organization_id` and
   * stop leaking PQRs across tenants.
   */
  @IsOptional()
  @IsInt()
  organization_id?: number;

  /**
   * Optional store ID when the requester is a single store (store-admin
   * acting on behalf of their own tienda) or a storefront visitor whose
   * tenancy we already know. Lets the org-admin table show "Tienda"
   * without a join through a fragile heuristic.
   */
  @IsOptional()
  @IsInt()
  store_id?: number;

  /**
   * Structured requester fields — preferred over the legacy `name`
   * + `email` + `phone` triplet. When all of these are provided, the
   * backend stores them in dedicated columns and the detail page
   * shows them in the Solicitante card instead of falling back to
   * the parsed description metadata. Legacy rows that only carry
   * `name` + `email` keep working through the parseRequester()
   * fallback in the service.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  requester_first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  requester_last_name?: string;

  @IsOptional()
  @IsEmail()
  requester_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requester_phone?: string;

  /**
   * Colombian document types most common for a PQR requester. Not
   * enforced as enum yet — open string to keep room for edge cases
   * (NIT, pasaporte, etc.) without a schema migration. Common values
   * the UI will offer: 'CC' (cédula), 'CE' (cédula extranjería),
   * 'NIT', 'PA' (pasaporte).
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  requester_document_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requester_document_num?: string;
}
