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
