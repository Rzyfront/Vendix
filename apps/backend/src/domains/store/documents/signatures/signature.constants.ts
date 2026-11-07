import { createHash } from 'crypto';

/** Life of a signature request and of its signer links. */
export const SIGNATURE_TTL_DAYS = 15;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum wait between two codes sent to the same signer. */
export const OTP_RESEND_SECONDS = 60;
/** Codes a signer can ask for during the life of the request. */
export const OTP_MAX_SENDS = 5;
/** A verified code stays valid this long to complete the signature. */
export const OTP_VERIFIED_TTL_MINUTES = 30;
export const MAX_SIGNERS = 10;
/** Largest decoded stroke accepted (PNG). */
export const SIGNATURE_IMAGE_MAX_BYTES = 200 * 1024;
export const DECLINE_REASON_MAX = 500;

export const WHATSAPP_LINK_TEMPLATE = 'vendix_firma_enlace';
export const WHATSAPP_OTP_TEMPLATE = 'vendix_firma_codigo';
export const WHATSAPP_LANGUAGE = 'es';

export const CONSENT_TEXT_VERSION = 'v1';
export const CONSENT_TEXT =
  'Acepto firmar electrónicamente este documento, identificado por su huella digital SHA-256, ' +
  'mediante una firma electrónica simple conforme a la Ley 527 de 1999 y al Decreto 2364 de 2012. ' +
  'Entiendo que mi firma se compone del trazo que dibujo, del código de un solo uso que recibí y de los datos de ' +
  'evidencia de esta sesión (hora, dirección IP y dispositivo), y que Vendix actúa como custodio del documento ' +
  'y de su evidencia, no como firmante.';

export type EvidenceEventType =
  | 'created'
  | 'sent'
  | 'opened'
  | 'otp_sent'
  | 'otp_failed'
  | 'otp_verified'
  | 'consent_accepted'
  | 'signed'
  | 'declined'
  | 'sealed'
  | 'cancelled'
  | 'expired';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Request states in which signers can still act. */
export const OPEN_REQUEST_STATUSES = ['pending', 'partially_signed'] as const;

/** `3***@ejemplo.com` / `+57 ******4567`: the destination without exposing it. */
export function maskDestination(method: 'otp_email' | 'otp_whatsapp', email: string | null, phone: string | null): string {
  if (method === 'otp_email') {
    const [user = '', domain = ''] = (email ?? '').split('@');
    return `${user.slice(0, 1)}***@${domain}`;
  }
  const digits = (phone ?? '').replace(/\D/g, '');
  return `******${digits.slice(-4)}`;
}
