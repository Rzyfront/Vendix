import { apiGet, apiPost, apiPatch, apiDelete } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  StorePaymentMethod,
  SystemPaymentMethod,
  PaymentMethodStats,
  UpdateStorePaymentMethodDto,
  EnableSystemPaymentMethodDto,
} from '@/core/models/org-admin/config.types';

/**
 * ⚠️ KNOWN ISSUE: estos endpoints están store-scoped (`/store/payment-methods/*`)
 * y un token ORG_ADMIN será rechazado por DomainScopeGuard con 403.
 * Se replica la UI web tal cual para paridad visual; el backend rechazará
 * con 403 hasta que se cree el equivalente bajo `/organization/payment-methods/*`.
 *
 * Espejo de apps/frontend/.../config/payment-methods/services/payment-methods.service.ts
 */

const SPM = Endpoints.STORE.STORE_PAYMENT_METHODS;

export const OrgPaymentMethodsService = {
  list: async () => apiGet<StorePaymentMethod[]>(SPM.LIST),
  listAvailable: async () => apiGet<SystemPaymentMethod[]>(SPM.AVAILABLE),
  getStats: async () => apiGet<PaymentMethodStats>(SPM.STATS),
  get: async (id: number | string) =>
    apiGet<StorePaymentMethod>(SPM.GET.replace(':id', String(id))),

  enableSystem: async (systemMethodId: number | string, body: EnableSystemPaymentMethodDto = {}) =>
    apiPost<StorePaymentMethod>(
      SPM.ENABLE_SYSTEM.replace(':systemMethodId', String(systemMethodId)),
      body,
    ),

  update: async (id: number | string, body: UpdateStorePaymentMethodDto) =>
    apiPatch<StorePaymentMethod>(SPM.UPDATE.replace(':id', String(id)), body),

  disable: async (id: number | string) =>
    apiPatch<StorePaymentMethod>(SPM.DISABLE.replace(':id', String(id)), {}),

  enable: async (id: number | string) =>
    apiPatch<StorePaymentMethod>(SPM.ENABLE.replace(':id', String(id)), {}),

  remove: async (id: number | string) =>
    apiDelete<void>(SPM.DELETE.replace(':id', String(id))),

  reorder: async (methods: { id: number | string; order: number }[]) =>
    apiPost<void>(SPM.REORDER, { methods }),
};