import { readFileSync } from 'fs';
import { join } from 'path';
import { DIAN_DOCUMENT_TYPES } from '../constants/dian-document-types';
import {
  UblAttachedDocumentBuilder,
  UblAttachedDocumentParams,
} from './ubl-attached-document.builder';
import {
  UblStructureValidator,
  summarizeUblViolations,
} from './ubl-structure.validator';

/**
 * F.12 / KG-4 — el `AttachedDocument` no tenía constructor. Este spec fija:
 *
 *   1. que el XML producido valida ESTRUCTURALMENTE contra el modelo de
 *      contenido extraído del XSD oficial (`UblStructureValidator`, la misma
 *      compuerta que ya corren los otros seis constructores), y
 *   2. que las tres piezas que el anexo exige (pág. 638) — el documento
 *      firmado, la representación gráfica y la respuesta de validación de la
 *      DIAN — quedan presentes cuando se proveen.
 */
describe('UblAttachedDocumentBuilder', () => {
  const sender = {
    document_type: '31',
    document_number: '900123456',
    document_dv: '1',
    legal_name: 'Tienda Demo SAS',
  };

  const receiver = {
    document_type: '31',
    document_number: '800987654',
    document_dv: '3',
    legal_name: 'Adquiriente SAS',
  };

  function build(overrides: Partial<UblAttachedDocumentParams> = {}): string {
    return UblAttachedDocumentBuilder.build({
      id: 'SETP990000001',
      issue_date: '2026-08-24',
      issue_time: '10:15:00-05:00',
      parent_document_key: 'a'.repeat(96),
      parent_document_key_scheme: 'CUFE-SHA384',
      parent_document_id: 'SETP990000001',
      parent_document_type_code: DIAN_DOCUMENT_TYPES.INVOICE,
      sender,
      receiver,
      attachment: {
        content_base64: 'ZG9jdW1lbnRvLWZpcm1hZG8=',
        mime_code: 'text/xml',
        filename: 'SETP990000001.xml',
      },
      environment: 'test',
      ...overrides,
    });
  }

  it('valida ESTRUCTURALMENTE contra el modelo de contenido del XSD oficial, sin violaciones', () => {
    const xml = build({
      graphic_representation_base64: 'cGRmLWJhc2U2NA==',
      dian_validation_response_base64: 'YXBwbGljYXRpb25yZXNwb25zZS1iYXNlNjQ=',
    });

    const result = UblStructureValidator.validate(xml);
    expect(result.root).toBe('AttachedDocument');
    expect(summarizeUblViolations(result.violations)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('lleva las TRES piezas que el anexo exige (pág. 638): documento firmado, representación gráfica y validación DIAN', () => {
    const xml = build({
      graphic_representation_base64: 'cGRmLWJhc2U2NA==',
      dian_validation_response_base64: 'YXBwbGljYXRpb25yZXNwb25zZS1iYXNlNjQ=',
    });

    // 1) el documento firmado, en el ÚNICO slot que el XSD reserva para un
    // adjunto binario embebido. `doc.end({ prettyPrint: true })` — igual que
    // en `UblApplicationResponseBuilder` — inserta salto de línea e
    // indentación entre un elemento padre y su hijo, así que el hijo se
    // comprueba solo (como hace el resto del repo con hojas) y el anidado
    // dentro de `cac:Attachment` se confirma por posición.
    const attachment_pos = xml.indexOf('<cac:Attachment>');
    const embedded_object_pos = xml.indexOf(
      '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/xml" filename="SETP990000001.xml">ZG9jdW1lbnRvLWZpcm1hZG8=</cbc:EmbeddedDocumentBinaryObject>',
    );
    expect(attachment_pos).toBeGreaterThan(-1);
    expect(embedded_object_pos).toBeGreaterThan(attachment_pos);
    // 2) y 3) representación gráfica y validación DIAN, cada una en su propio
    // `cbc:Note` con un prefijo que distingue cuál es cuál.
    expect(xml).toContain(
      '<cbc:Note>Representación gráfica (PDF), base64: cGRmLWJhc2U2NA==</cbc:Note>',
    );
    expect(xml).toContain(
      '<cbc:Note>ApplicationResponse de validación DIAN, base64: YXBwbGljYXRpb25yZXNwb25zZS1iYXNlNjQ=</cbc:Note>',
    );
  });

  it('las dos Notes son OPCIONALES: sin ellas el contenedor sigue siendo válido (p. ej. contingencia DIAN sin ApplicationResponse)', () => {
    const xml = build();

    expect(xml).not.toContain('<cbc:Note>');
    const result = UblStructureValidator.validate(xml);
    expect(summarizeUblViolations(result.violations)).toEqual([]);
  });

  it('cbc:ParentDocumentID precede a cbc:ParentDocumentTypeCode — el orden inverso de lo que el nombre sugiere, pero el que fija el XSD', () => {
    const xml = build();
    const id_pos = xml.indexOf('<cbc:ParentDocumentID>');
    const type_pos = xml.indexOf('<cbc:ParentDocumentTypeCode>');

    expect(id_pos).toBeGreaterThan(-1);
    expect(type_pos).toBeGreaterThan(id_pos);
  });

  it('el UUID del contenedor es la clave (CUFE/CUDE) del documento envuelto, con su @schemeName', () => {
    const xml = build({
      parent_document_key: 'z'.repeat(96),
      parent_document_key_scheme: 'CUDE-SHA384',
    });

    expect(xml).toContain(
      `<cbc:UUID schemeName="CUDE-SHA384">${'z'.repeat(96)}</cbc:UUID>`,
    );
  });

  it('reutiliza el ProfileID del documento envuelto en vez de inventar uno propio para el sobre', () => {
    const literal = 'DIAN 2.1: Factura Electrónica de Venta';
    const xml = build({ wrapped_profile_id: literal });

    expect(xml).toContain(`<cbc:ProfileID>${literal}</cbc:ProfileID>`);
  });

  it('sin wrapped_profile_id, cbc:ProfileID se omite en vez de declarar un literal no confirmado', () => {
    const xml = build();
    expect(xml).not.toContain('<cbc:ProfileID>');
  });

  it('el namespace raíz es el confirmado contra el XSD propio del repositorio, no uno de memoria', () => {
    const xml = build();
    expect(xml).toContain(
      'xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"',
    );
  });

  it('SenderParty/ReceiverParty reutilizan el mismo helper que ApplicationResponse — cero copias de la lógica de partes', () => {
    const builder_source = readFileSync(
      join(__dirname, 'ubl-attached-document.builder.ts'),
      'utf8',
    );
    expect(builder_source).toContain(
      'UblApplicationResponseBuilder.buildEventParty',
    );
    // Ninguna reconstrucción propia del bloque PartyTaxScheme/RegistrationName:
    // si apareciera, sería una segunda copia de `buildEventParty`.
    expect(builder_source).not.toMatch(/PartyTaxScheme[\s\S]{0,20}RegistrationName/);
  });
});
