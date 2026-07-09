/**
 * SocialSalesService — consumo de los endpoints de WhatsApp Business / Meta.
 *
 * Base URL: /store/social-sales/*
 * Permisos: store:social_sales:read / store:social_sales:manage
 *
 * Contrato exacto de apps/backend/src/domains/store/social-sales/.
 */
import { apiClient, Endpoints } from '@/core/api';
import type {
  MetaReadiness,
  WhatsappChannel,
  CompleteWhatsappEmbeddedSignupRequest,
} from '@/features/store/types/social-sales.types';

function unwrap<T>(response: { data: T | unknown }): T {
  const d = response.data as { success?: boolean; data: T };
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

export const SocialSalesService = {
  /**
   * GET /store/social-sales/meta/readiness
   * Permiso: store:social_sales:read
   *
   * Indica si Meta está configurado y si el store puede iniciar el
   * flujo de Embedded Signup (can_start_signup).
   */
  async getMetaReadiness(): Promise<MetaReadiness> {
    const res = await apiClient.get(Endpoints.STORE.SOCIAL_SALES.META_READINESS);
    return unwrap<MetaReadiness>(res);
  },

  /**
   * GET /store/social-sales/channels/whatsapp
   * Permiso: store:social_sales:read
   *
   * Estado actual del canal WhatsApp del store.
   * Cuando no existe canal conectado devuelve:
   * { connected: false, status: 'disconnected', provider: 'meta_cloud', channel_type: 'whatsapp' }
   */
  async getWhatsappChannel(): Promise<WhatsappChannel> {
    const res = await apiClient.get(Endpoints.STORE.SOCIAL_SALES.WHATSAPP_CHANNEL);
    return unwrap<WhatsappChannel>(res);
  },

  /**
   * POST /store/social-sales/channels/whatsapp/embedded-signup/complete
   * Permiso: store:social_sales:manage
   *
   * Completa el flujo de Meta Embedded Signup con el `code` obtenido
   * del popup de Facebook OAuth. El backend intercambia el code por
   * access_token, lo encripta y persiste el canal.
   *
   * @param dto — payload con code + waba_id + phone_number_id + opcionales
   */
  async completeWhatsappEmbeddedSignup(
    dto: CompleteWhatsappEmbeddedSignupRequest,
  ): Promise<WhatsappChannel> {
    const res = await apiClient.post(
      Endpoints.STORE.SOCIAL_SALES.WHATSAPP_COMPLETE_SIGNUP,
      dto,
    );
    return unwrap<WhatsappChannel>(res);
  },

  /**
   * POST /store/social-sales/channels/whatsapp/disconnect
   * Permiso: store:social_sales:manage
   *
   * Desconecta el canal WhatsApp. Limpia el access_token encriptado
   * y marca el canal como disconnected.
   */
  async disconnectWhatsapp(): Promise<WhatsappChannel> {
    const res = await apiClient.post(
      Endpoints.STORE.SOCIAL_SALES.WHATSAPP_DISCONNECT,
      {},
    );
    return unwrap<WhatsappChannel>(res);
  },
};
