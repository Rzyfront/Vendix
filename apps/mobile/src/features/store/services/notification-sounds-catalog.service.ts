import { apiClient, Endpoints } from '@/core/api';

/**
 * Notification sounds catalog — paridad con web
 * (apps/frontend/.../core/services/notification-sounds-catalog.service.ts).
 *
 * Réplica móvil del servicio de catálogo: pega a `GET /notification-sounds`
 * (controller en apps/backend/src/domains/store/notifications/notification-sounds-catalog.controller.ts).
 * El catálogo es global / read-only (seed inmutable en runtime); se cachea a
 * nivel de módulo para que cada dropdown de sonido re-use la misma Promise
 * sin re-pegar al backend en cada mount — mismo patrón que `uom.service.ts`.
 *
 * Mobile playback: el botón "Probar" en settings.tsx usa `expo-audio`
 * (en web se usa `new Audio(sound.url)` del browser).
 */

export interface NotificationSoundCatalogItem {
  id: string;
  name: string;
  url: string;
  sort_order: number;
}

interface CatalogApiResponse<T> {
  success?: boolean;
  message?: string;
  data: T;
}

let catalogPromise: Promise<NotificationSoundCatalogItem[]> | null = null;

export function getNotificationSoundsCatalog(
  forceReload = false,
): Promise<NotificationSoundCatalogItem[]> {
  if (!catalogPromise || forceReload) {
    catalogPromise = apiClient
      .get<CatalogApiResponse<NotificationSoundCatalogItem[]>>(
        Endpoints.STORE.NOTIFICATION_SOUNDS,
      )
      .then((res) => {
        const body = res.data;
        if (body && typeof body === 'object' && 'data' in body) {
          return body.data ?? [];
        }
        return (body as unknown as NotificationSoundCatalogItem[]) ?? [];
      })
      .catch((err) => {
        // Reset cache en caso de error para permitir reintento.
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}

/**
 * Invalida el cache del catálogo. Pensado para escenarios donde el admin
 * añade nuevos sonidos (hoy el seed es inmutable en runtime, pero expuesto
 * para simetría con `invalidateUomCatalog`).
 */
export function invalidateNotificationSoundsCatalog(): void {
  catalogPromise = null;
}