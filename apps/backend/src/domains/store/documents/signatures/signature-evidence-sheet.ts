export interface EvidenceSheetSigner {
  name: string;
  document_number: string | null;
  role_label: string | null;
  method: 'otp_email' | 'otp_whatsapp';
  /** Masked e-mail or phone the code went to. */
  destination: string;
  otp_verified_at: Date | null;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: Date | null;
}

export interface EvidenceSheetData {
  store_name: string;
  document_title: string;
  document_reference: string;
  /** SHA-256 of the issued PDF the signers signed. */
  document_sha256: string;
  consent_text_version: string;
  signers: EvidenceSheetSigner[];
  /** Hash of the last event of the chain when the seal was made. */
  chain_last_hash: string | null;
  generated_at: Date;
}

const METHOD_LABEL = { otp_email: 'correo electrónico', otp_whatsapp: 'WhatsApp' } as const;

function stamp(d: Date | null): string {
  return d ? `${new Date(d).toISOString().replace('T', ' ').slice(0, 19)} UTC` : '—';
}

/**
 * Writes the evidence sheet after the document: who signed, how the one-time
 * code was verified, from where, and the hashes that tie the sheet to the
 * document and to the evidence chain. Starts on a fresh page.
 */
export function drawEvidenceSheet(doc: PDFKit.PDFDocument, data: EvidenceSheetData): void {
  const left = 50;
  const width = doc.page.width - left * 2;
  doc.addPage();

  const line = (label: string, value: string) => {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(`${label}: `, left, doc.y, {
      width,
      continued: true,
    });
    doc.font('Helvetica').fillColor('#111827').text(value, { width });
  };

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text('Hoja de evidencia de firma electrónica', left, 50, { width });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text(
    'Firma electrónica simple (Ley 527 de 1999, Decreto 2364 de 2012). Vendix actúa como custodio del documento y de esta evidencia, no como firmante.',
    { width },
  );
  doc.moveDown();

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Documento');
  doc.moveDown(0.3);
  line('Tienda', data.store_name);
  line('Documento', `${data.document_title} (${data.document_reference})`);
  line('Huella SHA-256 del documento firmado', data.document_sha256);
  line('Texto de consentimiento', `versión ${data.consent_text_version}`);
  doc.moveDown();

  data.signers.forEach((s, i) => {
    if (doc.y > doc.page.height - 190) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(`Firmante ${i + 1}`, left, doc.y, { width });
    doc.moveDown(0.3);
    line('Nombre', s.name);
    line('Documento de identidad', s.document_number ?? '—');
    line('Rol', s.role_label ?? '—');
    line('Código de un solo uso', `enviado por ${METHOD_LABEL[s.method]} a ${s.destination}`);
    line('Código verificado', stamp(s.otp_verified_at));
    line('Firmó', stamp(s.signed_at));
    line('Dirección IP', s.ip_address ?? '—');
    line('Dispositivo', s.user_agent ?? '—');
    doc.moveDown();
  });

  if (doc.y > doc.page.height - 110) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Cadena de evidencia', left, doc.y, { width });
  doc.moveDown(0.3);
  line('Hash del último evento', data.chain_last_hash ?? '—');
  line('Sellado', stamp(data.generated_at));
}
