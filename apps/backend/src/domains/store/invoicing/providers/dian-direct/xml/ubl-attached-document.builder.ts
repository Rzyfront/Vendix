import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import {
  UblApplicationResponseBuilder,
  type DianEventParty,
} from './ubl-application-response.builder';
import { DianDocumentTypeCode } from '../constants/dian-document-types';

/**
 * Construye el `AttachedDocument` — el «contenedor electrónico» que el Anexo
 * Técnico 1.9 exige entregar al adquiriente junto con todo documento validado
 * (pág. 263, AE01 «Contenedor de Documentos Electrónicos – AttachedDocument
 * (raíz)»; §8.5 pág. 598 y pág. 638: «siempre que un documento es validado,
 * deberá ser transmitido para el adquiriente el respectivo contenedor»).
 *
 * CIERRA F.12 / KG-4 — hasta hoy Vendix firmaba y transmitía el documento a la
 * DIAN pero nunca envolvía el sobre. Los otros 7 constructores de esta carpeta
 * (`ubl-invoice`, `ubl-credit-note`, `ubl-debit-note`,
 * `ubl-equivalent-document`, `ubl-support-document`,
 * `ubl-application-response`, `ubl-common`) emiten TODOS documentos de
 * negocio; éste es el primero que emite el SOBRE que los transporta.
 *
 * ## Qué lleva dentro, y por qué en ese elemento
 *
 * El anexo (pág. 638) exige que el contenedor lleve tres piezas: el documento
 * firmado, su representación gráfica y el documento de validación de la DIAN.
 * El XSD oficial (`AttachedDocumentType`, `dian-ubl-content-model.ts`) sólo
 * ofrece UN `cac:Attachment` (máx. 1) con UN `cbc:EmbeddedDocumentBinaryObject`
 * — no hay tres slots dedicados. La distribución que este builder usa:
 *
 *   1. **El documento firmado** → `cac:Attachment/cbc:EmbeddedDocumentBinaryObject`,
 *      base64, con `@mimeCode` y `@filename`. Es la pieza que el modelo UBL
 *      declara expresamente para este propósito — un `AttachedDocument`
 *      genérico existe PARA adjuntar un documento a otro.
 *   2. **La representación gráfica** (PDF) y **el documento de validación**
 *      (el `ApplicationResponse` de la DIAN) → un `cbc:Note` cada uno
 *      (`cbc:Note` es `0..*` en el modelo), en base64 y con un prefijo que
 *      identifica cuál es cuál — el patrón que la comunidad de integradores
 *      describe para el mismo problema (la respuesta de la DIAN viaja como
 *      texto base64 dentro de un tag de texto: «XmlBase64Bytes» en las
 *      respuestas de `SendBillSync`/`GetStatus`, facturasyrespuestas.com,
 *      consultado 2026-08-24).
 *
 *   ⚠️ **SIN VERIFICAR LÍNEA A LÍNEA CONTRA EL PDF DEL ANEXO.** No fue posible
 *   extraer el texto de la pág. 638 en esta sesión (el buscador sólo devolvió
 *   fragmentos y un directorio no autenticado de operaciones.colombiacompra.gov.co
 *   con XML reales de `AttachedDocument` que resultaron ser PDFs binarios, no
 *   XML). La estructura de arriba es la que el propio XSD permite y la que las
 *   fuentes públicas describen de forma consistente, pero **antes de transmitir
 *   un contenedor real a producción hay que validarlo contra un envío de
 *   pruebas de la DIAN** (ambiente `test`), no sólo contra este XSD.
 *
 * ## Qué NO hace, a propósito
 *
 * - No firma el contenedor (`cac:Signature` queda vacío, `0..*` lo permite).
 *   El anexo exige que el documento ENVUELTO llegue firmado, no que el sobre
 *   lleve su propia firma XAdES — y añadir una sin verificarlo sería inventar
 *   un requisito.
 * - No emite `cbc:DocumentTypeCode`/`cbc:DocumentType` de nivel superior (son
 *   `0..1`, opcionales): el catálogo correcto para ese par NO es
 *   necesariamente `DIAN_DOCUMENT_TYPES` — esa tabla es la de
 *   `cbc:InvoiceTypeCode` del documento envuelto, y el modelo declara
 *   `cbc:ParentDocumentTypeCode` como un elemento APARTE para exactamente ese
 *   dato. Se prefiere omitir un elemento opcional a declarar un código de un
 *   catálogo no confirmado.
 * - No reinventa el `cbc:ProfileID`: lo reutiliza tal cual lo emitió el
 *   documento envuelto (`params.wrapped_profile_id`), evitando declarar una
 *   segunda verdad sobre el mismo literal — el mismo criterio que ya aplicó
 *   `PROFILE_ID_CREDIT_NOTE`/`PROFILE_ID_DEBIT_NOTE` en este archivo hermano.
 *
 * ## Orden de los elementos
 *
 * Fijado por `AttachedDocumentType` en `dian-ubl-content-model.ts` (extraído
 * del XSD oficial, no a mano):
 *   UBLVersionID → CustomizationID → ProfileID → ProfileExecutionID → ID →
 *   UUID → IssueDate → IssueTime → Note* → ParentDocumentID →
 *   ParentDocumentTypeCode → SenderParty → ReceiverParty → Attachment
 *
 * `UblStructureValidator.validate(xml).root === 'AttachedDocument'` con
 * `violations: []` confirma que este orden y esta cardinalidad son válidos
 * contra el propio modelo de contenido — ver
 * `ubl-attached-document.builder.spec.ts`.
 */

export interface UblAttachedDocumentPartyInput extends DianEventParty {}

export interface UblAttachedDocumentAttachment {
  /** Base64 del documento YA FIRMADO (Invoice/CreditNote/DebitNote/SupportDocument). */
  content_base64: string;
  /** `@mimeCode` de `cbc:EmbeddedDocumentBinaryObject`. Siempre `text/xml` para el documento envuelto. */
  mime_code: string;
  /** `@filename` — el mismo nombre con el que el documento se transmitió a la DIAN. */
  filename: string;
}

export interface UblAttachedDocumentParams {
  /** `cbc:ID` del propio contenedor. Vendix usa el número del documento envuelto: un contenedor por documento. */
  id: string;
  /** `cbc:IssueDate`, `YYYY-MM-DD`. */
  issue_date: string;
  /** `cbc:IssueTime`, `HH:mm:ss-05:00`. */
  issue_time?: string;
  /** CUFE/CUDE del documento envuelto — identifica de forma única cuál es el contenido de este sobre. */
  parent_document_key: string;
  parent_document_key_scheme: 'CUFE-SHA384' | 'CUDE-SHA384';
  /** Número/consecutivo del documento envuelto — `cbc:ParentDocumentID` (obligatorio, 1..1). */
  parent_document_id: string;
  /** `cbc:InvoiceTypeCode` del documento envuelto (`DIAN_DOCUMENT_TYPES.*`). */
  parent_document_type_code: DianDocumentTypeCode;
  sender: UblAttachedDocumentPartyInput;
  receiver: UblAttachedDocumentPartyInput;
  attachment: UblAttachedDocumentAttachment;
  /**
   * Representación gráfica (PDF) en base64. Ausente en el camino de
   * contingencia DEL FACTURADOR, donde el PDF puede no existir todavía.
   */
  graphic_representation_base64?: string;
  /**
   * `ApplicationResponse` de la DIAN, en base64. AUSENTE a propósito para
   * `DIAN_DOCUMENT_TYPES.CONTINGENCY_DIAN_INVOICE` («04»): el propio catálogo
   * documenta que ese camino se entrega «dentro de un AttachedDocument SIN
   * ApplicationResponse» porque el servicio de validación no estaba
   * disponible cuando se emitió.
   */
  dian_validation_response_base64?: string;
  /**
   * `cbc:ProfileID` — se reutiliza el MISMO literal que el documento envuelto
   * ya emitió (`UBL_CONSTANTS.PROFILE_ID*`), no uno inventado para el sobre.
   */
  wrapped_profile_id?: string;
  /** `cbc:CustomizationID` del documento envuelto, si aplica reutilizarlo. */
  wrapped_customization_id?: string;
  environment: 'test' | 'production';
}

export class UblAttachedDocumentBuilder {
  static build(params: UblAttachedDocumentParams): string {
    const {
      id,
      issue_date,
      issue_time,
      parent_document_key,
      parent_document_key_scheme,
      parent_document_id,
      parent_document_type_code,
      sender,
      receiver,
      attachment,
      graphic_representation_base64,
      dian_validation_response_base64,
      wrapped_profile_id,
      wrapped_customization_id,
      environment,
    } = params;

    const profile_execution_id =
      environment === 'production'
        ? UBL_CONSTANTS.PROFILE_EXECUTION_ID_PROD
        : UBL_CONSTANTS.PROFILE_EXECUTION_ID_TEST;

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(UBL_NAMESPACES.ATTACHED_DOCUMENT, 'AttachedDocument')
      .att('xmlns:cac', UBL_NAMESPACES.CAC)
      .att('xmlns:cbc', UBL_NAMESPACES.CBC)
      .att('xmlns:ext', UBL_NAMESPACES.EXT)
      .att('xmlns:sts', UBL_NAMESPACES.STS)
      .att('xmlns:ds', UBL_NAMESPACES.DS)
      .att('xmlns:xades', UBL_NAMESPACES.XADES)
      .att('xmlns:xades141', UBL_NAMESPACES.XADES141);

    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    if (wrapped_customization_id) {
      doc
        .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
        .txt(wrapped_customization_id);
    }
    if (wrapped_profile_id) {
      doc.ele(UBL_NAMESPACES.CBC, 'ProfileID').txt(wrapped_profile_id);
    }
    doc
      .ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID')
      .txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(id);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeName', parent_document_key_scheme)
      .txt(parent_document_key);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(issue_date);
    if (issue_time) {
      doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);
    }

    // `cbc:Note` — las dos piezas que el `cac:Attachment` único no puede
    // llevar. Prefijo explícito: dos Notes sin marcar serían indistinguibles
    // para quien reciba el sobre, que es peor que no entregarlas.
    if (graphic_representation_base64) {
      doc
        .ele(UBL_NAMESPACES.CBC, 'Note')
        .txt(
          `Representación gráfica (PDF), base64: ${graphic_representation_base64}`,
        );
    }
    if (dian_validation_response_base64) {
      doc
        .ele(UBL_NAMESPACES.CBC, 'Note')
        .txt(
          `ApplicationResponse de validación DIAN, base64: ${dian_validation_response_base64}`,
        );
    }

    // El modelo fija `cbc:ParentDocumentID` ANTES de
    // `cbc:ParentDocumentTypeCode` (`dian-ubl-content-model.ts`), al revés de
    // lo que la lectura superficial del nombre sugeriría — invertirlos es
    // exactamente el defecto de orden que `UblStructureValidator` existe para
    // atrapar antes de firmar.
    doc.ele(UBL_NAMESPACES.CBC, 'ParentDocumentID').txt(parent_document_id);
    doc
      .ele(UBL_NAMESPACES.CBC, 'ParentDocumentTypeCode')
      .txt(parent_document_type_code);

    UblApplicationResponseBuilder.buildEventParty(doc, 'SenderParty', sender);
    UblApplicationResponseBuilder.buildEventParty(
      doc,
      'ReceiverParty',
      receiver,
    );

    const cac_attachment = doc.ele(UBL_NAMESPACES.CAC, 'Attachment');
    cac_attachment
      .ele(UBL_NAMESPACES.CBC, 'EmbeddedDocumentBinaryObject')
      .att('mimeCode', attachment.mime_code)
      .att('filename', attachment.filename)
      .txt(attachment.content_base64);

    return doc.end({ prettyPrint: true });
  }
}
