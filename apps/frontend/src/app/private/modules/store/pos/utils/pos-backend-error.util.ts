/**
 * Extracts the operable message out of a rejected POS request (QUI-559).
 *
 * `HttpErrorResponse.message` is a transport description, not a business
 * reason: a stock block surfaced to the cashier as
 * `Http failure response for https://api.vendix.com/api/store/payments/pos: 409 Conflict`,
 * which says nothing about which product is short or by how much. The real
 * reason travels in the parsed body (`error.error.message`) built by
 * `VendixHttpException`, so that is what the toast must read.
 *
 * Kept as a pure function — no Angular deps — so every POS surface (payment
 * step, credit sale, add-to-cart) resolves the message identically and the
 * behaviour is unit-testable without a TestBed.
 */

/** Shape of the backend error envelope (`VendixHttpException`). */
interface VendixErrorBody {
  message?: string | string[];
  error_code?: string;
  errors?: Array<{ message?: string }>;
}

/**
 * @param error   Anything a failed request threw: `HttpErrorResponse`, a plain
 *                `Error`, or an already-parsed envelope.
 * @param fallback Message shown when nothing usable can be extracted.
 */
export function extractPosErrorMessage(error: unknown, fallback: string): string {
  const err = error as
    | { error?: VendixErrorBody | string; message?: string }
    | undefined;

  const body = err?.error;

  // A 409/400 from the API: the body carries the human-readable reason. When
  // class-validator rejects a DTO, `message` is an array of constraint strings.
  if (body && typeof body === 'object') {
    const message = body.message;
    if (Array.isArray(message) && message.length) {
      return message.filter(Boolean).join(' ');
    }
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    const nested = body.errors?.find((e) => !!e?.message)?.message;
    if (nested?.trim()) return nested;
  }

  // Some layers stringify the body before re-throwing.
  if (typeof body === 'string' && body.trim() && !isTransportMessage(body)) {
    return body;
  }

  // A plain `Error` thrown by a frontend guard (cart service, validators) is
  // already user-facing — but an HttpErrorResponse's own `message` is not.
  if (err?.message?.trim() && !isTransportMessage(err.message)) {
    return err.message;
  }

  return fallback;
}

/**
 * True for Angular's transport-level text, the string this util exists to keep
 * off the screen.
 */
function isTransportMessage(message: string): boolean {
  return message.startsWith('Http failure response');
}

/**
 * Backend error code (`INV_STOCK_002`, `POS_STOCK_INSUFFICIENT_001`, …) when
 * present. Useful to branch behaviour without string-matching the message.
 */
export function extractPosErrorCode(error: unknown): string | null {
  const body = (error as { error?: VendixErrorBody } | undefined)?.error;
  if (body && typeof body === 'object' && typeof body.error_code === 'string') {
    return body.error_code;
  }
  return null;
}
