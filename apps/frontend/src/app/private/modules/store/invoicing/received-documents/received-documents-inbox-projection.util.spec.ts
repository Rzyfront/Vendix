import type { ReceivedDocumentReceptionStatus } from './received-documents.interface';
import { receivedChannelLabel, receivedInboxEmptyState, receivedInboxLabel, receivedLegalLabel, receivedOcrLabel, receivedTypeLabel } from './received-documents-inbox-projection.util';

const readyHealth: ReceivedDocumentReceptionStatus = {
  dian_active: true, configured: true, active_connections: 1, channels: ['api_poll'],
  last_received_at: null, last_synced_at: null, next_sync_at: null, last_run: null,
  error_code: null, requires_operational_store: false,
};

describe('received inbox display projection', () => {
  it('keeps attention and legal axes independent without inventing legal acceptance', () => {
    expect(receivedInboxLabel('requires_review')).toBe('Requiere revisión');
    expect(receivedLegalLabel('accepted')).toBe('Aceptada');
    expect(receivedLegalLabel('none')).toBe('Sin aceptación ni reclamo');
    expect(receivedLegalLabel('conflict')).toBe('Evidencia legal en conflicto');
    expect(receivedLegalLabel('success')).toBe('Estado legal no disponible');
    expect(receivedInboxLabel(undefined)).toBe('Estado no disponible');
    expect(receivedInboxLabel('rejected')).toBe('Estado no disponible');
  });
  it('names document types, channel origins and OCR honestly', () => {
    expect(receivedTypeLabel('credit_note')).toBe('Nota crédito');
    expect(receivedChannelLabel('automated')).toBe('Webhook');
    expect(receivedChannelLabel('api_poll')).toBe('API de proveedor');
    expect(receivedChannelLabel('email')).toBe('Correo (origen declarado)');
    expect(receivedOcrLabel('pending_ocr')).toBe('Lectura pendiente');
    expect(receivedOcrLabel('error')).toBe('Error de lectura');
    expect(receivedOcrLabel('ready')).toBe('Documento disponible');
  });
  it('uses filtered empty instead of onboarding and retains clear filters', () => {
    const state = receivedInboxEmptyState(null, true, true);
    expect(state.title).toBe('Ninguna factura coincide con los filtros');
    expect(state.clearFilters).toBe(true);
    expect(state.configure).toBe(false);
  });
  it('distinguishes inactive DIAN, missing/disabled channels, and a ready inbox', () => {
    expect(receivedInboxEmptyState({ ...readyHealth, dian_active: false }, false, true).configure).toBe(true);
    expect(receivedInboxEmptyState({ ...readyHealth, configured: false }, false, true).title).toBe('Conecta un proveedor compatible');
    expect(receivedInboxEmptyState({ ...readyHealth, active_connections: 0 }, false, true).title).toBe('Activa un canal de recepción');
    expect(receivedInboxEmptyState(readyHealth, false, true).title).toBe('Tu buzón está listo');
    expect(receivedInboxEmptyState(null, false, true).configure).toBe(false);
  });
  it('does not offer configuration to readers without write permission', () => {
    for (const health of [{ ...readyHealth, dian_active: false }, { ...readyHealth, configured: false }, { ...readyHealth, active_connections: 0 }]) {
      const state = receivedInboxEmptyState(health, false, false);
      expect(state.configure).toBe(false);
      expect(state.description).toMatch(/administrador/);
    }
  });
});
