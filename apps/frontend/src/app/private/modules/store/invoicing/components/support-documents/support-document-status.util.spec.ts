import {
  canDownloadSupportPdf,
  canEmitSupportDocument,
  supportStatusLabel,
  supportStatusVariant,
  supportTypeLabel,
  supportXmlFileName,
} from './support-document-status.util';

describe('support-document-status.util', () => {
  it('usa etiquetas masculinas de documento', () => {
    expect(supportStatusLabel('validated')).toBe('Validado');
    expect(supportStatusLabel('accepted')).toBe('Aceptado');
    expect(supportStatusLabel('otro')).toBe('otro');
  });

  it('alinea cancelado (gris) y anulado (ámbar) con la lista de facturas', () => {
    expect(supportStatusVariant('cancelled')).toBe('neutral');
    expect(supportStatusVariant('voided')).toBe('warning');
    expect(supportStatusVariant('rejected')).toBe('error');
  });

  it('distingue la etiqueta corta y larga de la nota de ajuste', () => {
    expect(supportTypeLabel('support_adjustment_note')).toBe('Nota de ajuste al documento soporte');
    expect(supportTypeLabel('support_adjustment_note', true)).toBe('Nota de ajuste');
  });

  it('solo borrador y validado se emiten', () => {
    expect(canEmitSupportDocument('draft')).toBeTrue();
    expect(canEmitSupportDocument('validated')).toBeTrue();
    expect(canEmitSupportDocument('sent')).toBeFalse();
    expect(canEmitSupportDocument('accepted')).toBeFalse();
  });

  it('el PDF solo aplica al documento soporte', () => {
    expect(canDownloadSupportPdf('support_document')).toBeTrue();
    expect(canDownloadSupportPdf('support_adjustment_note')).toBeFalse();
  });

  it('nombra el XML con el número del documento', () => {
    expect(supportXmlFileName('DS100')).toBe('DS100.xml');
  });
});
