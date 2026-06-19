/**
 * ApiError — typed error thrown by the apiGet/apiPost/etc. helpers when the
 * backend returns a `{ success: false, message, error, ... }` envelope.
 *
 * Some backend controllers catch thrown exceptions and wrap them in
 * ResponseService.error(), returning HTTP 200 with success:false. Without this
 * type, callers used to receive that envelope as if it were the typed payload —
 * which blew up at runtime when the consumer expected, e.g., an array.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;
  public readonly body: any;

  constructor(
    message: string,
    body: any,
    options: { statusCode?: number; errorCode?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = options.statusCode ?? (body?.statusCode ?? 0);
    this.errorCode = options.errorCode ?? body?.error_code;
    this.body = body;
  }
}
