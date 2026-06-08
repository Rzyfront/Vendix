import { apiGet, apiPost, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { Invoice, InvoiceResolution, DianConfig, DianCertificateStatus } from '@/core/models/org-admin/invoicing.types';

export const OrgInvoicingService = {
  // Invoices
  listInvoices: async (params?: ListParams) =>
    apiGet<Invoice[]>(Endpoints.ORGANIZATION.INVOICING.INVOICES, params),
  getInvoice: async (id: string) =>
    apiGet<Invoice>(Endpoints.ORGANIZATION.INVOICING.INVOICE_GET.replace(':id', id)),
  getInvoicePdf: async (invoiceId: string) =>
    apiGet<{ url: string }>(Endpoints.ORGANIZATION.INVOICING.INVOICE_PDF.replace(':invoiceId', invoiceId)),
  // Resolutions
  listResolutions: async (params?: ListParams) =>
    apiGet<InvoiceResolution[]>(Endpoints.ORGANIZATION.INVOICING.RESOLUTIONS, params),
  getResolution: async (id: string) =>
    apiGet<InvoiceResolution>(Endpoints.ORGANIZATION.INVOICING.RESOLUTION_GET.replace(':id', id)),
  // DIAN config
  getDianConfig: async () =>
    apiGet<DianConfig>(Endpoints.ORGANIZATION.INVOICING.DIAN_CONFIG),
  getDianConfigById: async (id: string) =>
    apiGet<DianConfig>(Endpoints.ORGANIZATION.INVOICING.DIAN_CONFIG_GET.replace(':id', id)),
  uploadDianCertificate: async (id: string, body: FormData) =>
    apiPost(Endpoints.ORGANIZATION.INVOICING.DIAN_CONFIG_UPLOAD_CERT.replace(':id', id), body),
  requestDianCertificate: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.INVOICING.DIAN_CONFIG_REQUEST_CERT.replace(':id', id)),
  getDianCertificateStatus: async (id: string) =>
    apiGet<DianCertificateStatus>(Endpoints.ORGANIZATION.INVOICING.DIAN_CONFIG_STATUS.replace(':id', id)),
};
