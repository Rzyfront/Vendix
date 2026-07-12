/**
 * AnunciosService — Marketing — Anuncios (Ad Creatives) module.
 *
 * Mirror del servicio web (`apps/frontend/.../anuncios/anuncios.service.ts`)
 * sobre el endpoint compartido del backend
 * `apps/backend/src/domains/store/marketing-ad-creatives/`.
 *
 * Toda la lógica de generación / quota / post-copy vive en el backend (regla
 * mobile-dev RULE 6: nunca duplicar lógica backend en mobile). Este servicio
 * solo serializa requests, deserializa el envelope `{ data, message, meta }`
 * y expone el SSE stream.
 *
 * El contrato end-to-end está documentado en `docs/parity-audit-anuncios.md`
 * §8 (Consumed endpoints) y §9 (Side-effects).
 */

import EventSource from 'react-native-sse';

import { apiClient, Endpoints } from '@/core/api';
import { getToken } from '@/core/auth/token.storage';
import { API_BASE_URL } from '@/core/api/endpoints';
import type {
  ApiResponse,
  AdCreativeStreamEvent,
  CreateMarketingAdCreativeDto,
  MarketingAdCreative,
  MarketingAdCreativeSummary,
  MarketingAdEcommerceDomain,
  PaginatedResponse,
  QueryMarketingAdCreativesParams,
  SuggestMarketingAdPromptDto,
  SuggestedMarketingAdPrompt,
  UpdateMarketingAdCreativeDetailsDto,
} from '@/features/store/types/anuncios.types';

// ── Helpers de envelope ───────────────────────────────────────────────────────

type ApiEnvelope<T> = { success?: boolean; data: T; message?: string; meta?: unknown };

function unwrap<T>(payload: T | ApiEnvelope<T> | { data: T }): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function unwrapWithMessage<T>(
  payload: T | ApiEnvelope<T> | { data: T; message?: string },
): { data: T; message?: string } {
  if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
    return payload as { data: T; message?: string };
  }
  return { data: payload as T };
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface AnunciosApiResponse<T> {
  data: T;
  message?: string;
}

export interface StreamGenerateOptions {
  /** Optional override (otherwise a uuid is generated client-side). */
  requestId?: string;
  /** Optional user-supplied correction text; sent as `?correction=` query. */
  correction?: string;
  /** Identifier for the underlying EventSource; used by `stop()`. */
  onEvent: (event: AdCreativeStreamEvent) => void;
  onError?: (err: unknown) => void;
  onOpen?: () => void;
}

export const AnunciosService = {
  // ── Listado + filtros ──────────────────────────────────────────────────────

  /**
   * Lista paginada de anuncios. Acepta page/limit/search/status/format.
   * Backend default `limit=12`; el web usa 60 hard-coded en
   * `anuncios.component.ts:639`. Mobile usa `limit=20` por defecto,
   * consistente con Promociones.
   */
  async list(
    query: QueryMarketingAdCreativesParams = {},
  ): Promise<PaginatedResponse<MarketingAdCreative>> {
    const params: Record<string, string | number> = {};
    if (query.page) params.page = query.page;
    if (query.limit) params.limit = query.limit;
    if (query.search?.trim()) params.search = query.search.trim();
    if (query.status) params.status = query.status;
    if (query.format) params.format = query.format;

    const res = await apiClient.get(Endpoints.STORE.MARKETING_AD_CREATIVES.LIST, {
      params,
    });

    const body = res.data as
      | ApiResponse<MarketingAdCreative[]>
      | { data: MarketingAdCreative[]; meta?: unknown; pagination?: unknown }
      | MarketingAdCreative[];
    const inner =
      body && typeof body === 'object' && 'success' in body
        ? (body as ApiResponse<MarketingAdCreative[]>).data
        : Array.isArray(body)
          ? body
          : ((body as { data: MarketingAdCreative[] }).data ?? []);
    const meta = (body && typeof body === 'object' && 'meta' in body
      ? (body as { meta?: unknown }).meta
      : undefined) as
      | { page?: number; limit?: number; total?: number; total_pages?: number; totalPages?: number }
      | undefined;
    const page = Number(meta?.page ?? query.page ?? 1);
    const limit = Number(meta?.limit ?? query.limit ?? 20);
    const total = Number(meta?.total ?? inner.length);
    const totalPages = Number(
      meta?.totalPages ?? meta?.total_pages ?? Math.max(1, Math.ceil(total / limit)),
    );

    return {
      data: inner,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },

  /**
   * Resumen con 4 métricas: total / completados / procesando / fallidos.
   * El endpoint es `/store/marketing/ad-creatives/summary`.
   */
  async getSummary(): Promise<MarketingAdCreativeSummary> {
    const res = await apiClient.get(Endpoints.STORE.MARKETING_AD_CREATIVES.SUMMARY);
    return unwrap<MarketingAdCreativeSummary | { data: MarketingAdCreativeSummary }>(
      res.data,
    ) as MarketingAdCreativeSummary;
  },

  /**
   * Detalle de un anuncio por id (con `creative_products` y `creative_images`).
   */
  async getById(id: number): Promise<MarketingAdCreative> {
    const endpoint = Endpoints.STORE.MARKETING_AD_CREATIVES.GET.replace(
      ':id',
      String(id),
    );
    const res = await apiClient.get(endpoint);
    return unwrap<MarketingAdCreative | { data: MarketingAdCreative }>(
      res.data,
    ) as MarketingAdCreative;
  },

  /**
   * Devuelve el dominio ecommerce activo (hostname/url) para asociar al CTA.
   * Retorna `null` si la tienda no tiene dominio ecommerce.
   */
  async getEcommerceDomain(): Promise<MarketingAdEcommerceDomain | null> {
    const res = await apiClient.get(
      Endpoints.STORE.MARKETING_AD_CREATIVES.ECOMMERCE_DOMAIN,
    );
    const unwrapped = unwrap<
      | MarketingAdEcommerceDomain
      | { data: MarketingAdEcommerceDomain | null }
      | null
    >(res.data);
    if (!unwrapped) return null;
    if (
      typeof unwrapped === 'object' &&
      'data' in (unwrapped as object)
    ) {
      return (unwrapped as { data: MarketingAdEcommerceDomain | null }).data ?? null;
    }
    return unwrapped as MarketingAdEcommerceDomain;
  },

  // ── Crear / actualizar / eliminar ─────────────────────────────────────────

  /**
   * Crea un anuncio en estado `draft` con la configuración inicial (format,
   * products, gallery, etc.). El backend NO arranca la generación acá; eso
   * sucede en el SSE stream.
   */
  async create(
    dto: CreateMarketingAdCreativeDto,
  ): Promise<AnunciosApiResponse<MarketingAdCreative>> {
    const res = await apiClient.post(Endpoints.STORE.MARKETING_AD_CREATIVES.CREATE, dto);
    return unwrapWithMessage<MarketingAdCreative>(
      res.data as
        | MarketingAdCreative
        | ApiEnvelope<MarketingAdCreative>
        | { data: MarketingAdCreative; message?: string },
    );
  },

  /**
   * Sugiere un prompt + título usando el AI app
   * `marketing_ad_prompt_specialist`. El backend lo invoca y devuelve el
   * texto pulido + notas opcionales.
   */
  async suggestPrompt(
    dto: SuggestMarketingAdPromptDto,
  ): Promise<SuggestedMarketingAdPrompt> {
    const res = await apiClient.post(
      Endpoints.STORE.MARKETING_AD_CREATIVES.SUGGEST_PROMPT,
      dto,
    );
    return unwrap<SuggestedMarketingAdPrompt | { data: SuggestedMarketingAdPrompt }>(
      res.data,
    ) as SuggestedMarketingAdPrompt;
  },

  /**
   * Actualiza título/descripción de un anuncio. NO se usa en el flujo
   * principal mobile (el web tampoco lo usa); mantenido por paridad con
   * el endpoint backend.
   */
  async updateDetails(
    id: number,
    dto: UpdateMarketingAdCreativeDetailsDto,
  ): Promise<AnunciosApiResponse<MarketingAdCreative>> {
    const endpoint = Endpoints.STORE.MARKETING_AD_CREATIVES.UPDATE.replace(
      ':id',
      String(id),
    );
    const res = await apiClient.patch(endpoint, dto);
    return unwrapWithMessage<MarketingAdCreative>(
      res.data as
        | MarketingAdCreative
        | ApiEnvelope<MarketingAdCreative>
        | { data: MarketingAdCreative; message?: string },
    );
  },

  async remove(id: number): Promise<{ message: string }> {
    const endpoint = Endpoints.STORE.MARKETING_AD_CREATIVES.DELETE.replace(
      ':id',
      String(id),
    );
    const res = await apiClient.delete(endpoint);
    const unwrapped = unwrap<
      { message: string } | { data: null; message: string } | { data: { message: string } }
    >(res.data) as { message?: string; data?: { message?: string } | null };
    return { message: unwrapped.message ?? unwrapped.data?.message ?? '' };
  },

  // ── Imagen proxy (download / share / copy) ─────────────────────────────────

  /**
   * Devuelve el blob de la imagen generada. El backend sirve la imagen desde
   * S3 con `Access-Control-Allow-Origin` echo + `Content-Type` apropriado.
   *
   * En RN usamos axios `responseType: 'arraybuffer'` para conservar los
   * bytes raw que `expo-file-system` espera al guardarlos como cache file.
   */
  async getImageBlob(
    id: number,
    variant: 'full' | 'thumb' = 'full',
  ): Promise<{ buffer: ArrayBuffer; contentType: string; bufferUri: string }> {
    const endpoint = Endpoints.STORE.MARKETING_AD_CREATIVES.IMAGE.replace(
      ':id',
      String(id),
    );
    const res = await apiClient.get<ArrayBuffer>(endpoint, {
      params: { variant },
      responseType: 'arraybuffer',
    });
    const contentType =
      (res.headers?.['content-type'] as string | undefined) ?? 'image/png';
    const bufferUri = `data:${contentType};base64,${arrayBufferToBase64(res.data)}`;
    return { buffer: res.data, contentType, bufferUri };
  },

  /**
   * Construye la URL con token para proxies de imagen de producto (usado por
   * los previews en el gallery picker del wizard). El backend exige token
   * via query string para imágenes privadas.
   */
  async productImageProxyUrl(imageId: number): Promise<string> {
    const token = await getToken();
    const base = Endpoints.STORE.MARKETING_AD_CREATIVES.IMAGE_PROXY.replace(
      ':imageId',
      String(imageId),
    );
    const sep = base.includes('?') ? '&' : '?';
    return token ? `${base}${sep}token=${token}` : base;
  },

  // ── SSE stream ────────────────────────────────────────────────────────────

  /**
   * Abre una conexión SSE a `/:id/generate-stream?token=...&request_id=...&correction=...`.
   * Devuelve una función para cerrar/abortar la conexión.
   *
   * Tokens via query (NO headers) porque `react-native-sse` no soporta
   * custom headers en EventSource (igual que el browser EventSource del web).
   *
   * El backend envía eventos `ai-chunk` con payloads JSON con la shape
   * `AdCreativeStreamEvent`. El servicio deserializa y llama
   * `onEvent(parsed)`. El caller debe mantener una referencia a la función
   * de cleanup para evitar leaks (e.g., guardarla en un ref del wizard).
   */
  streamGenerate(
    id: number,
    options: StreamGenerateOptions,
  ): () => void {
    let closed = false;
    let cancellationReason: 'caller' | 'complete' | 'error' = 'caller';
    let requestId = options.requestId;
    let source: EventSource<'ai-chunk'> | null = null;
    const close = () => {
      if (closed) return;
      closed = true;
      if (source) {
        try {
          source.removeAllEventListeners();
          source.close();
        } catch {
          // best effort
        }
      }
    };

    (async () => {
      if (!requestId) requestId = await generateRequestId(id);
      const token = await getToken();
      const basePath = Endpoints.STORE.MARKETING_AD_CREATIVES.STREAM_GENERATE.replace(
        ':id',
        String(id),
      );
      const params = new URLSearchParams();
      params.set('request_id', requestId);
      if (token) params.set('token', token);
      if (options.correction?.trim()) {
        params.set('correction', options.correction.trim());
      }
      const url = `${API_BASE_URL.replace(/\/$/, '')}${basePath}?${params.toString()}`;
      try {
        source = new EventSource<'ai-chunk'>(url);
        options.onOpen?.();

        source.addEventListener('ai-chunk', (raw) => {
          if (closed || !('data' in raw) || !raw.data) return;
          try {
            const data = JSON.parse(raw.data) as AdCreativeStreamEvent;
            options.onEvent(data);
            if (
              (data.type === 'done' || data.type === 'error') &&
              cancellationReason === 'caller'
            ) {
              cancellationReason = data.type === 'done' ? 'complete' : 'error';
              close();
            }
          } catch {
            options.onEvent({
              type: 'error',
              error: 'No se pudo leer el stream de generacion.',
            });
            cancellationReason = 'error';
            close();
          }
        });

        source.addEventListener('error', () => {
          if (closed) return;
          options.onEvent({
            type: 'error',
            error: 'Se perdio la conexion con el stream.',
          });
          cancellationReason = 'error';
          close();
          options.onError?.(new Error('sse-error'));
        });
      } catch (err) {
        options.onError?.(err);
        options.onEvent({
          type: 'error',
          error: 'No se pudo conectar con la generacion.',
        });
        cancellationReason = 'error';
        close();
      }
    })();

    return close;
  },
};

// ── Helpers internos ─────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // RN no expone `btoa` consistentemente; usamos Buffer/typed array si está
  // disponible, fallback a una implementación manual.
  // Try `Buffer` first (Hermes lo expone desde RN 0.72+).
  try {
    const g = globalThis as unknown as { Buffer?: { from: (a: ArrayBuffer) => { toString: (s: string) => string } } };
    if (g.Buffer) {
      return g.Buffer.from(buffer).toString('base64');
    }
  } catch {
    // ignore
  }
  // Fallback manual
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  // RN-hermes no expone `btoa` global, usamos un truco con globalThis.
  // Si esto tampoco funciona, retornamos string vacío y el caller
  // maneará el error via `contentType` por defecto `image/png`.
  // (Esto es improbable en Hermes >= RN 0.74.)
  try {
    const g = globalThis as unknown as { btoa?: (s: string) => string };
    if (g.btoa) return g.btoa(binary);
  } catch {
    // ignore
  }
  return '';
}

async function generateRequestId(id: number): Promise<string> {
  // Intentamos `crypto.randomUUID` (disponible en RN >= 0.71 con polyfill
  // `react-native-get-random-values` o via expo-crypto). Si no está,
  // caemos a un fallback determinístico.
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // ignore
  }
  const g = globalThis as unknown as {
    expo?: { Crypto?: { digestStringAsync: (alg: string, data: string) => Promise<string> } };
    Buffer?: { from: (a: string) => { toString: (s: string) => string } };
  };
  try {
    if (g.expo?.Crypto) {
      const ts = String(Date.now());
      const rand = String(Math.random());
      const hex = await g.expo.Crypto.digestStringAsync(
        'SHA256',
        `ad-creative-${id}-${ts}-${rand}`,
      );
      return hex.slice(0, 36);
    }
  } catch {
    // ignore
  }
  return `ad-creative-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
