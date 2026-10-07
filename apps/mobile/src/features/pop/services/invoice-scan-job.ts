import { apiClient, Endpoints } from '@/core/api';

const POLL_INTERVAL_MS = 2500;
const MAX_TOTAL_MS = 600_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_POLL_NETWORK_RETRIES = 2;

const SCAN_ERROR_MESSAGES: Record<string, string> = {
  INV_SCAN_NO_FILE: 'Selecciona la factura que quieres escanear.',
  INV_SCAN_INVALID_FILE: 'Formato no soportado. Sube la factura como JPG, PNG, WebP o PDF.',
  INV_SCAN_AI_FAIL:
    'No pudimos leer la factura. Vuelve a intentarlo; si persiste, sube una foto más nítida o carga los productos manualmente.',
  INV_SCAN_PARSE_FAIL:
    'La lectura de la factura llegó dañada. Vuelve a intentarlo con una imagen más nítida.',
  INV_SCAN_INCOMPLETE:
    'No se pudieron leer los datos mínimos de la factura (proveedor y productos). Sube una imagen más nítida o la página donde aparece el detalle de los productos.',
};

const GENERIC_ERROR = 'No se pudo procesar la factura. Intenta nuevamente.';
const TIMEOUT_ERROR = 'El escaneo tardó demasiado. Intenta nuevamente.';
const EXPIRED_ERROR = 'El escaneo ya no está disponible. Vuelve a intentarlo.';

export class InvoiceScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceScanError';
  }
}

/** Cancelación cooperativa: el llamador la dispara al desmontar/cerrar. */
export interface ScanCancelToken {
  cancelled: boolean;
}

function mapScanError(error?: string): string {
  if (!error) return GENERIC_ERROR;
  const code = Object.keys(SCAN_ERROR_MESSAGES).find((c) => error.includes(c));
  return code ? SCAN_ERROR_MESSAGES[code] : GENERIC_ERROR;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encola el escaneo y sondea hasta completed/failed (tope 600 s).
 * Resuelve con el mismo resultado que devolvía el scan síncrono en `data`.
 * Si `token.cancelled` se activa, resuelve `null` sin más llamadas.
 */
export async function scanInvoiceAndWait(
  formData: FormData,
  token: ScanCancelToken,
): Promise<any | null> {
  const enqueue = await apiClient.post<any>(
    `${Endpoints.STORE.PURCHASE_ORDERS.SCAN_ASYNC}?orderType=retail`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    },
  );
  const jobId: string | number | undefined = enqueue.data?.data?.job_id ?? enqueue.data?.job_id;
  if (jobId === undefined || jobId === null) {
    throw new InvoiceScanError(GENERIC_ERROR);
  }

  const statusUrl = Endpoints.STORE.PURCHASE_ORDERS.SCAN_ASYNC_STATUS.replace(
    ':jobId',
    encodeURIComponent(String(jobId)),
  );
  const startedAt = Date.now();
  let networkRetries = 0;

  while (!token.cancelled) {
    await sleep(POLL_INTERVAL_MS);
    if (token.cancelled) return null;
    if (Date.now() - startedAt > MAX_TOTAL_MS) {
      throw new InvoiceScanError(TIMEOUT_ERROR);
    }

    let body: any;
    try {
      const res = await apiClient.get<any>(statusUrl);
      body = res.data;
      networkRetries = 0;
    } catch (err: any) {
      if (err?.response?.status === 404) {
        throw new InvoiceScanError(EXPIRED_ERROR);
      }
      // Sin respuesta (red) o 5xx: transitorio, se reintenta limitado.
      const transient = !err?.response || err.response.status >= 500;
      if (transient && networkRetries < MAX_POLL_NETWORK_RETRIES) {
        networkRetries += 1;
        continue;
      }
      throw err;
    }

    if (body?.status === 'completed') {
      return body.result ?? null;
    }
    if (body?.status === 'failed') {
      throw new InvoiceScanError(mapScanError(body.error));
    }
  }
  return null;
}
