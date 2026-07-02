/**
 * Gym Suite — Ola 1.
 * Frontend source of truth for gym access control (credentials + logs).
 *
 * Mirrors the Prisma models `gym_access_credentials` / `gym_access_logs` and
 * the DTO contracts in `apps/backend/src/domains/store/gym-access`.
 *
 * NOTE: credentials are references only (QR / PIN / external device ref). No
 * raw biometric template is ever stored or sent — biometrics live on the
 * access device.
 */

export type GymCredentialType = 'qr' | 'pin' | 'external_ref';

export type GymAccessResult =
  | 'granted'
  | 'denied_no_membership'
  | 'denied_expired'
  | 'denied_suspended'
  | 'denied_frozen'
  | 'denied_quota_exceeded';

export interface GymAccessCredential {
  id: number;
  store_id: number;
  customer_id: number;
  credential_type: GymCredentialType;
  credential_value: string;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateCredentialDto {
  customer_id: number;
  credential_type: GymCredentialType;
  credential_value: string;
  is_active?: boolean;
}

export interface UpdateCredentialDto {
  credential_value?: string;
  is_active?: boolean;
}

export interface CredentialQuery {
  page?: number;
  limit?: number;
  customer_id?: number;
  is_active?: boolean;
}

export interface GymAccessLog {
  id: number;
  store_id: number;
  customer_id?: number | null;
  membership_id?: number | null;
  credential_id?: number | null;
  result: GymAccessResult;
  reason?: string | null;
  device_id?: string | null;
  access_at: string | Date;
}

export interface AccessLogQuery {
  page?: number;
  limit?: number;
  customer_id?: number;
  result?: GymAccessResult;
  date_from?: string;
  date_to?: string;
}

export interface ValidateAccessDto {
  credential_type: GymCredentialType;
  credential_value: string;
  device_id?: string;
}

export interface AccessValidationResult {
  granted: boolean;
  result: GymAccessResult;
  reason: string | null;
  customer_id: number | null;
  membership_id: number | null;
}

export const GYM_CREDENTIAL_TYPE_LABELS: Record<GymCredentialType, string> = {
  qr: 'Código QR',
  pin: 'PIN',
  external_ref: 'Referencia externa',
};

export const GYM_ACCESS_RESULT_LABELS: Record<GymAccessResult, string> = {
  granted: 'Concedido',
  denied_no_membership: 'Sin membresía',
  denied_expired: 'Vencida',
  denied_suspended: 'Suspendida',
  denied_frozen: 'Congelada',
  denied_quota_exceeded: 'Límite alcanzado',
};

/** Result → 7-char hex color (colorMap requires hex, not Tailwind classes). */
export const GYM_ACCESS_RESULT_COLORS: Record<GymAccessResult, string> = {
  granted: '#16a34a',
  denied_no_membership: '#dc2626',
  denied_expired: '#b45309',
  denied_suspended: '#dc2626',
  denied_frozen: '#2563eb',
  denied_quota_exceeded: '#7c3aed',
};
