import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { UblCommonBuilder } from './ubl-common.builder';
import {
  DIAN_EVENT_LABELS,
  DianEventCode,
} from '../constants/dian-endpoints';
import { DIAN_DOCUMENT_TYPES } from '../constants/dian-document-types';
import { DianSoftwareSecurity } from '../interfaces/dian-config.interface';

/**
 * A party of a RADIAN event. Deliberately thinner than `DianIssuerData` /
 * `DianCustomerData`: an `ApplicationResponse` identifies sender and receiver by
 * tax registration only — it carries no addresses, no tax regime and no
 * responsibilities, because the event references a document that already
 * declared all of that.
 */
export interface DianEventParty {
  /** DIAN identification type code ('31' NIT, '13' CC, …). */
  document_type: string;
  /** Identification WITHOUT dots, dashes or DV. */
  document_number: string;
  /** Verification digit, when the identification is a NIT. */
  document_dv?: string;
  /** Registered name as it appears in the referenced document. */
  legal_name: string;
}

/**
 * Extra data the negotiable-instrument events (035–051) carry and the reception
 * family (030–034) does not. Every field is optional here and enforced upstream by
 * `DianEventsService`, which knows the per-event required sets — a builder that
 * throws on missing data is a builder no test can exercise in isolation.
 */
export interface DianEventDetails {
  /**
   * Endorsee / direct buyer / competent officer, depending on the event.
   * `cac:DocumentResponse/cac:IssuerParty` per the annex XPath.
   */
  issuer_party?: DianEventParty;
  /**
   * `@listID` of the Response: '1' endoso completo, '2' endoso en blanco
   * (numeral 14.2.3). Only meaningful on the endorsement events.
   */
  endorsement_list_id?: string;
  /**
   * `Name`/`Value` pairs of the `InformacionNegociacion` extension. Use the
   * literals in `DIAN_NEGOTIATION_FIELDS` — the annex rejects on the literal.
   */
  negotiation_info?: ReadonlyArray<{ name: string; value: string }>;
  /**
   * Mandate validity. The annex treats an ABSENT period as "mandato ilimitado",
   * so an empty date pair must be omitted rather than emitted blank.
   */
  validity_start_date?: string;
  validity_end_date?: string;
}

export interface UblApplicationResponseParams {
  /** Event consecutive assigned by us — `cbc:ID` of the ApplicationResponse. */
  event_number: string;
  /** RADIAN event code: also the `cbc:ResponseCode`. */
  event_code: DianEventCode;
  /**
   * `cbc:CustomizationID` — "tipo de operación" from numeral 14.1.2. Defaults to
   * the event code, which is what the annex itself uses for the events that have
   * a single operation type.
   */
  operation_code?: string;
  /** Extra blocks required by the 035–051 family. */
  details?: DianEventDetails;
  /** CUDE of THIS ApplicationResponse (SHA-384, software PIN as ClTec). */
  cude: string;
  /** Event issue date, `YYYY-MM-DD`. */
  issue_date: string;
  /** Event issue time with offset, `HH:mm:ss-05:00`. */
  issue_time: string;
  /** Party that generates the event. */
  sender: DianEventParty;
  /** Party the event is addressed to. */
  receiver: DianEventParty;
  /** Referenced document number, e.g. `SETP990000001`. */
  referenced_document_number: string;
  /** CUFE/CUDE of the referenced document. */
  referenced_document_key: string;
  /** Referenced document issue date, `YYYY-MM-DD`. */
  referenced_document_date: string;
  /**
   * `cbc:DocumentTypeCode` of the referenced document. Defaults to '01'
   * (factura electrónica de venta), which is the only document the 030–034
   * family applies to.
   */
  referenced_document_type_code?: string;
  software_security: DianSoftwareSecurity;
  environment: 'test' | 'production';
  /** Free-text justification. Mandatory in practice for a reclamo (031). */
  description?: string;
}

/**
 * Builds the UBL 2.1 `ApplicationResponse` that carries a RADIAN document event
 * (Res. 000085/2022) to `SendEventUpdateStatus`.
 *
 * ✅ VERIFIED against the official **Anexo Técnico RADIAN v1.1** PDF: the event
 * codes (numeral 14.2.1), the operation types that feed `cbc:CustomizationID`
 * (14.1.2), the endorsement `@listID` (14.2.3), the `cbc:ProfileID` literal
 * (rule AAD03) and the `cac:IssuerParty` position inside `cac:DocumentResponse`.
 *
 * Still unverified, and deliberately kept in ONE place each: the namespace of the
 * `CustomTagGeneral` block (see `UblCommonBuilder.buildExtensions`) and the exact
 * `cac:ValidityPeriod` container for a mandate's dates. Same discipline as
 * `utils/dian-file-naming.util.ts`.
 *
 * Element order matters: UBL is sequence-validated, so an element emitted out of
 * order is an XSD failure, not a warning. The order below is
 *   UBLExtensions → UBLVersionID → CustomizationID → ProfileID →
 *   ProfileExecutionID → ID → UUID → IssueDate → IssueTime →
 *   SenderParty → ReceiverParty → DocumentResponse
 */
export class UblApplicationResponseBuilder {
  static build(params: UblApplicationResponseParams): string {
    const {
      event_number,
      event_code,
      operation_code,
      details,
      cude,
      issue_date,
      issue_time,
      sender,
      receiver,
      referenced_document_number,
      referenced_document_key,
      referenced_document_date,
      referenced_document_type_code,
      software_security,
      environment,
      description,
    } = params;

    const profile_execution_id =
      environment === 'production'
        ? UBL_CONSTANTS.PROFILE_EXECUTION_ID_PROD
        : UBL_CONSTANTS.PROFILE_EXECUTION_ID_TEST;

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele(UBL_NAMESPACES.APPLICATION_RESPONSE, 'ApplicationResponse')
      .att('xmlns:cac', UBL_NAMESPACES.CAC)
      .att('xmlns:cbc', UBL_NAMESPACES.CBC)
      .att('xmlns:ext', UBL_NAMESPACES.EXT)
      .att('xmlns:sts', UBL_NAMESPACES.STS)
      .att('xmlns:ds', UBL_NAMESPACES.DS)
      .att('xmlns:xades', UBL_NAMESPACES.XADES)
      .att('xmlns:xades141', UBL_NAMESPACES.XADES141);

    // An event is NOT covered by a numbering resolution, so `control` is
    // deliberately omitted: emitting an empty InvoiceControl with an invented
    // authorization number is worse than omitting the block.
    UblCommonBuilder.buildExtensions(doc, software_security, {
      issuer_nit: sender.document_number,
      issuer_nit_dv: sender.document_dv,
      qr_code: UblCommonBuilder.buildQrUrl(environment, cude),
      negotiation_info: details?.negotiation_info,
    });

    doc.ele(UBL_NAMESPACES.CBC, 'UBLVersionID').txt(UBL_CONSTANTS.UBL_VERSION);
    // "Tipo de operación" (numeral 14.1.2), NOT the event code — the two coincide
    // only for events with a single operation type. An endorsement, a mandate or a
    // payment carries a 3-digit code that says WHICH variant it is, and sending
    // the event code instead is a rejection on rule AAD02.
    doc
      .ele(UBL_NAMESPACES.CBC, 'CustomizationID')
      .txt(operation_code || event_code);
    doc
      .ele(UBL_NAMESPACES.CBC, 'ProfileID')
      .txt(UBL_CONSTANTS.PROFILE_ID_EVENT);
    doc
      .ele(UBL_NAMESPACES.CBC, 'ProfileExecutionID')
      .txt(profile_execution_id);
    doc.ele(UBL_NAMESPACES.CBC, 'ID').txt(event_number);
    doc
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeID', profile_execution_id)
      .att('schemeName', 'CUDE-SHA384')
      .txt(cude);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueDate').txt(issue_date);
    doc.ele(UBL_NAMESPACES.CBC, 'IssueTime').txt(issue_time);

    UblApplicationResponseBuilder.buildEventParty(doc, 'SenderParty', sender);
    UblApplicationResponseBuilder.buildEventParty(
      doc,
      'ReceiverParty',
      receiver,
    );

    const document_response = doc.ele(
      UBL_NAMESPACES.CAC,
      'DocumentResponse',
    );

    const response = document_response.ele(UBL_NAMESPACES.CAC, 'Response');
    const response_code = response.ele(UBL_NAMESPACES.CBC, 'ResponseCode');
    // `@listID` distinguishes an endorsement signed in blank (art. 654 C.Co.) from
    // a complete one. Omitted entirely outside the endorsement events: an empty
    // listID is not "no endorsement type", it is an invalid code.
    if (details?.endorsement_list_id) {
      response_code.att('listID', details.endorsement_list_id);
    }
    response_code.txt(event_code);
    response
      .ele(UBL_NAMESPACES.CBC, 'Description')
      .txt(description || DIAN_EVENT_LABELS[event_code] || event_code);

    // Mandate validity. An ABSENT period means "mandato ilimitado" to the annex, so
    // emitting blank dates would assert a bounded mandate with no bounds.
    if (details?.validity_start_date || details?.validity_end_date) {
      const period = response.ele(UBL_NAMESPACES.CAC, 'ValidityPeriod');
      if (details.validity_start_date) {
        period
          .ele(UBL_NAMESPACES.CBC, 'StartDate')
          .txt(details.validity_start_date);
      }
      if (details.validity_end_date) {
        period.ele(UBL_NAMESPACES.CBC, 'EndDate').txt(details.validity_end_date);
      }
    }

    const reference = document_response.ele(
      UBL_NAMESPACES.CAC,
      'DocumentReference',
    );
    reference.ele(UBL_NAMESPACES.CBC, 'ID').txt(referenced_document_number);
    // The referenced key is a CUFE when the document is an invoice; its
    // schemeName tells RADIAN which algorithm produced it.
    reference
      .ele(UBL_NAMESPACES.CBC, 'UUID')
      .att('schemeName', 'CUFE-SHA384')
      .txt(referenced_document_key);
    reference
      .ele(UBL_NAMESPACES.CBC, 'IssueDate')
      .txt(referenced_document_date);
    reference
      .ele(UBL_NAMESPACES.CBC, 'DocumentTypeCode')
      .txt(referenced_document_type_code || DIAN_DOCUMENT_TYPES.INVOICE);

    // `cac:IssuerParty` — the endorsee, the direct buyer of a prior-direct
    // negotiation, or the competent officer of a circulation limit, depending on
    // the event. UBL sequences DocumentResponse as
    // Response → DocumentReference → IssuerParty → RecipientParty, so this must
    // come AFTER the reference block or the XSD fails.
    if (details?.issuer_party) {
      UblApplicationResponseBuilder.buildEventParty(
        document_response,
        'IssuerParty',
        details.issuer_party,
      );
    }

    return doc.end({ prettyPrint: true });
  }

  /**
   * `cac:SenderParty` / `cac:ReceiverParty`. Both share the same shape: a
   * `cac:PartyTaxScheme` with the registration name, the identification and an
   * empty `cac:TaxScheme` (RADIAN does not classify the party's tax scheme —
   * the referenced document already did).
   *
   * NO `private`: `UblAttachedDocumentBuilder` reutiliza este mismo método para
   * sus propios `cac:SenderParty`/`cac:ReceiverParty` — que en `AttachedDocumentType`
   * resuelven al mismo `PartyType` genérico que aquí (confirmado contra
   * `dian-ubl-content-model.ts`) y con el mismo propósito: identificar a quien
   * envía y a quien recibe el intercambio, no repetir los datos comerciales
   * completos que el documento envuelto ya declaró. Una segunda copia de este
   * método es exactamente la clase de asimetría que F.8 tuvo que cerrar.
   */
  static buildEventParty(
    parent: any,
    element: 'SenderParty' | 'ReceiverParty' | 'IssuerParty',
    party: DianEventParty,
  ): void {
    const tax_scheme = parent
      .ele(UBL_NAMESPACES.CAC, element)
      .ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');

    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(party.legal_name);

    const company_id = tax_scheme.ele(UBL_NAMESPACES.CBC, 'CompanyID');
    company_id.att('schemeName', party.document_type);
    if (party.document_dv) {
      company_id.att('schemeID', party.document_dv);
    }
    company_id.txt(party.document_number);

    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'TaxLevelCode')
      .att('listName', party.document_type === '31' ? '48' : '49')
      .txt('R-99-PN');

    tax_scheme.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
  }
}
