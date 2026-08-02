import { DEFAULT_STORE_TIMEZONE } from '../utils/store-timezone.util';

/**
 * Vendix itself is the DIAN obligado for subscription invoices and for the
 * documentos soporte it issues to its own vendors. Those documents have no
 * tenant store to borrow a timezone from, so they use the platform's.
 *
 * It is an IANA zone name, never a fixed offset: the offset is derived per
 * instant so a future DST rule change (or a move of the fiscal domicile) does
 * not silently shift every emitted document.
 */
export const PLATFORM_TIMEZONE = DEFAULT_STORE_TIMEZONE;

/**
 * `platform_settings.key` holding the platform's own DIAN billing switch
 * (`is_enabled`, `environment`, entity/config/resolution ids).
 *
 * Shared rather than private to the superadmin service because checkout also
 * reads it: it must not ask a customer for fiscal data that no document will
 * ever carry. Two copies of this string would drift the day it is renamed and
 * the customer-facing side would keep demanding NITs for nothing.
 */
export const PLATFORM_FISCAL_SETTINGS_KEY = 'subscription_fiscal_billing';
