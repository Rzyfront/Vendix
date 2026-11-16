/** platform_settings key holding the Superadmin messaging prices. */
export const MESSAGING_PRICES_SETTINGS_KEY = 'messaging:prices';

/** Per-segment SMS price when no table has an entry: deliberately high. */
export const SMS_FALLBACK_PRICE_PER_SEGMENT_USD = 0.1;
/** Upper bound in USD for one SMS (`AWS.SNS.SMS.MaxPrice`). */
export const SMS_FALLBACK_MAX_PRICE_USD = 0.5;
/** `MaxPrice` = reserved cost × margin; 1 means SNS never charges more than reserved. */
export const SMS_FALLBACK_MAX_PRICE_MARGIN = 1;
/** WhatsApp marketing estimate when no table has an entry: deliberately high. */
export const WHATSAPP_FALLBACK_PRICE_USD = 0.05;
/** Campaign email estimate. */
export const EMAIL_FALLBACK_PRICE_USD = 0.0001;
