import { create } from 'xmlbuilder2';
import { UBL_NAMESPACES, UBL_CONSTANTS } from './xml-namespaces';
import { DIAN_TAX_CODES, DIAN_TAX_NAMES } from '../constants/dian-tax-codes';
import { DIAN_ID_TYPES } from '../constants/dian-document-types';
import {
  DianIssuerData,
  DianCustomerData,
  DianSoftwareSecurity,
  DianInvoiceControl,
} from '../interfaces/dian-config.interface';
import {
  ProviderInvoiceTax,
  ProviderInvoiceItem,
} from '../../invoice-provider.interface';
import { createHash } from 'crypto';
import {
  dianAmount,
  dianArithmetic,
  dianLineExtension,
  dianLineExtensionTotal,
  dianLineGross,
  dianRate,
  dianSum,
  dianUnitPrice,
  toDecimal,
} from '../../../utils/dian-money.util';

/**
 * Campos de dirección que los builders UBL saben emitir. Es el subconjunto
 * común de `DianIssuerData` y `DianCustomerData`, extraído para que las dos
 * formas de dirección —envuelta en `cac:Address` y plana— compartan firma.
 */
interface DianAddressFields {
  address_line?: string;
  city_code?: string;
  city_name?: string;
  department_code?: string;
  department_name?: string;
  country_code?: string;
  postal_code?: string;
}

/**
 * Shared UBL 2.1 element builders for Colombian electronic invoicing.
 * Used by both invoice and credit note builders.
 */
export class UblCommonBuilder {
  /** DIAN scheme agency attributes shared by every sts:* identifier. */
  private static readonly DIAN_SCHEME_AGENCY_NAME =
    'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)';

  /**
   * Responsabilidades ACEPTADAS por `cbc:TaxLevelCode` (Anexo 1.9).
   *
   * NO es el catálogo de la casilla 53 del RUT. Son dos listas distintas y ese es
   * el defecto que esto cierra: una migración escribió las responsabilidades del
   * RUT (`O-05, O-07, O-14, O-42, O-48`) en el campo que alimenta este elemento, y
   * la DIAN respondió FAJ26 «Responsabilidad informada por emisor no valida según
   * lista». Antes declaraba `O-13;O-47`, que sí están en la enumeración — por eso
   * FAJ26 no aparecía.
   *
   * `R-99-PN` es el valor «ninguna de las anteriores» de la propia lista, y es el
   * respaldo correcto: un contribuyente cuyas responsabilidades del RUT no caen en
   * ninguna de estas categorías no declara ninguna, no inventa una.
   */
  private static readonly TAX_LEVEL_CODES = new Set([
    'O-13', // Gran contribuyente
    'O-15', // Autorretenedor
    'O-23', // Agente de retención IVA
    'O-47', // Régimen simple de tributación
    'R-99-PN', // No responsable / ninguna de las anteriores
  ]);

  /** Valor «ninguna de las anteriores» de la lista de responsabilidades. */
  static readonly TAX_LEVEL_CODE_NONE = 'R-99-PN';

  /**
   * Filtra a la enumeración de `cbc:TaxLevelCode`.
   *
   * Acepta la forma con punto y coma que el anexo permite (`'O-13;O-15'`), descarta
   * lo que no pertenece a la lista, y devuelve `R-99-PN` cuando no queda nada.
   * Nunca propaga un código del RUT que la DIAN rechazaría.
   */
  static toTaxLevelCode(value?: string | null): string {
    const kept = String(value ?? '')
      .split(';')
      .map((code) => code.trim())
      .filter((code) => UblCommonBuilder.TAX_LEVEL_CODES.has(code));
    return kept.length
      ? kept.join(';')
      : UblCommonBuilder.TAX_LEVEL_CODE_NONE;
  }

  /**
   * Builds the UBLExtensions element with the full DIAN `sts:DianExtensions`
   * block that DIAN validates, in the mandated order:
   *   1. InvoiceControl  (InvoiceAuthorization, AuthorizationPeriod, AuthorizedInvoices)
   *   2. InvoiceSource   (country code 'CO')
   *   3. SoftwareProvider (ProviderID = software provider NIT, SoftwareID = DIAN GUID)
   *   4. SoftwareSecurityCode
   *   5. AuthorizationProvider (always the DIAN NIT 800197268)
   *   6. QRCode          (document consultation URL, contains the CUFE/CUDE/CUDS)
   * A second empty UBLExtension is appended as the placeholder for the XAdES
   * digital signature (inserted later by dian-xml-signer.service.ts).
   *
   * `options.control`, `options.issuer_nit`/`issuer_nit_dv` and
   * `options.qr_code` are optional so existing callers keep compiling; the
   * orchestrator populates them from the numbering resolution + CUFE.
   */
  static buildExtensions(
    parent: any,
    software_security: DianSoftwareSecurity,
    options?: {
      control?: DianInvoiceControl;
      issuer_nit?: string;
      issuer_nit_dv?: string;
      qr_code?: string;
      /**
       * `Name`/`Value` pairs for the RADIAN `InformacionNegociacion` block. Emitted
       * as its OWN `ext:UBLExtension`, between the DIAN extension and the signature
       * placeholder, because that is where the annex's XPath puts it:
       * `ext:UBLExtension/ext:ExtensionContent/CustomTagGeneral/InformacionNegociacion`.
       */
      negotiation_info?: ReadonlyArray<{ name: string; value: string }>;
    },
  ): void {
    const agency_name = UblCommonBuilder.DIAN_SCHEME_AGENCY_NAME;
    const dian = parent
      .ele(UBL_NAMESPACES.EXT, 'UBLExtensions')
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent')
      .ele(UBL_NAMESPACES.STS, 'DianExtensions');

    // 1. InvoiceControl — numbering resolution authorization + range.
    const control = options?.control;
    const invoice_control = dian.ele(UBL_NAMESPACES.STS, 'InvoiceControl');
    invoice_control
      .ele(UBL_NAMESPACES.STS, 'InvoiceAuthorization')
      .txt(control?.invoice_authorization ?? '');
    const period = invoice_control.ele(
      UBL_NAMESPACES.STS,
      'AuthorizationPeriod',
    );
    period
      .ele(UBL_NAMESPACES.CBC, 'StartDate')
      .txt(control?.authorization_start_date ?? '');
    period
      .ele(UBL_NAMESPACES.CBC, 'EndDate')
      .txt(control?.authorization_end_date ?? '');
    const authorized = invoice_control.ele(
      UBL_NAMESPACES.STS,
      'AuthorizedInvoices',
    );
    // Prefix is optional (0..1) — omit the element when the resolution has none.
    if (control?.prefix) {
      authorized.ele(UBL_NAMESPACES.STS, 'Prefix').txt(control.prefix);
    }
    authorized.ele(UBL_NAMESPACES.STS, 'From').txt(control?.range_from ?? '');
    authorized.ele(UBL_NAMESPACES.STS, 'To').txt(control?.range_to ?? '');

    // 2. InvoiceSource — ISO 3166-1 country code of the document source.
    dian
      .ele(UBL_NAMESPACES.STS, 'InvoiceSource')
      .ele(UBL_NAMESPACES.CBC, 'IdentificationCode')
      .att('listAgencyID', '6')
      .att('listAgencyName', 'United Nations Economic Commission for Europe')
      .att(
        'listSchemeURI',
        'urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1',
      )
      .txt(UBL_CONSTANTS.COUNTRY_CODE);

    // 3. SoftwareProvider — ProviderID is the software provider NIT (falls back
    //    to the issuer NIT for self-developed software); SoftwareID is the DIAN
    //    software GUID.
    const software = dian.ele(UBL_NAMESPACES.STS, 'SoftwareProvider');
    // ProviderID: NIT of the software provider WITHOUT its DV (the DV is the
    // schemeID). schemeAgencyID/@schemeName/@schemeID are all mandatory (1..1).
    software
      .ele(UBL_NAMESPACES.STS, 'ProviderID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .att(
        'schemeID',
        software_security.provider_nit_dv ?? options?.issuer_nit_dv ?? '',
      )
      .att('schemeName', '31') // 31 = NIT
      .txt(software_security.provider_nit ?? options?.issuer_nit ?? '');

    // `sts:SoftwareID` con S MAYÚSCULA.
    //
    // Aquí decía `softwareID` en minúscula, con un comentario que afirmaba que la
    // mayúscula «falla la validación de esquema» — sin citar fuente. La medición
    // dice lo contrario: la validación sincrónica del 2026-08-08 devolvió TRES
    // reglas del mismo bloque diciendo «no informado» sobre valores que el XML SÍ
    // llevaba:
    //
    //   FAB24a  «No se encuentra informado el código de software»
    //   FAB25   «No informado el literal “195”»          <- schemeAgencyID
    //   FAB26   «No informado el literal “CO, DIAN (…)”» <- schemeAgencyName
    //
    // Los dos literales están presentes y son exactos, y van pegados como
    // atributos de ESTE elemento. Que la DIAN los declare ausentes significa que
    // su XPath no encuentra el elemento que los porta: tres reglas, un nombre mal
    // escrito. Es el mismo patrón que FAB10a con `CorporateRegistrationScheme`.
    //
    // Corrobora la mayúscula el propio repositorio: los builders de nómina
    // (`nomina-individual.builder.ts`, `nomina-adjustment.builder.ts`) emiten
    // `SoftwareID`. Y el comentario anterior es exactamente la forma de error que
    // `dian-test-set-composition.ts` documenta: una afirmación sin fuente que cada
    // relectura confirmaba.
    software
      .ele(UBL_NAMESPACES.STS, 'SoftwareID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .txt(software_security.software_id);

    // 4. SoftwareSecurityCode.
    dian
      .ele(UBL_NAMESPACES.STS, 'SoftwareSecurityCode')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .txt(software_security.software_security_code);

    // 5. AuthorizationProvider — always the DIAN NIT.
    dian
      .ele(UBL_NAMESPACES.STS, 'AuthorizationProvider')
      .ele(UBL_NAMESPACES.STS, 'AuthorizationProviderID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', agency_name)
      .att('schemeID', '4')
      .att('schemeName', '31')
      .txt(UBL_CONSTANTS.DIAN_NIT);

    // 6. QRCode — document consultation URL (embeds the CUFE/CUDE/CUDS).
    if (options?.qr_code) {
      dian.ele(UBL_NAMESPACES.STS, 'QRCode').txt(options.qr_code);
    }

    // dian → .up() ExtensionContent → .up() UBLExtension → .up() UBLExtensions
    const extensions = dian
      .up() // → ExtensionContent
      .up() // → UBLExtension (first)
      .up(); // → UBLExtensions

    // Optional UBLExtension: RADIAN negotiation data. Goes BEFORE the signature
    // placeholder so the signature stays the last extension — the signer replaces
    // the last empty ExtensionContent, and inserting after it would leave the
    // negotiation block unsigned.
    const negotiation_info = options?.negotiation_info;
    if (negotiation_info?.length) {
      // NO namespace, matching the annex XPath
      // (`.../ext:ExtensionContent/CustomTagGeneral/InformacionNegociacion`: the
      // last two segments carry no prefix while every DIAN element around them
      // does). The explicit `null` is load-bearing — `ele('CustomTagGeneral')`
      // INHERITS the parent's `ext:` prefix in xmlbuilder2, which silently emits
      // `<ext:CustomTagGeneral>` and no longer matches the XPath the annex
      // validates. Passing null undeclares the namespace instead.
      const negotiation = extensions
        .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
        .ele(UBL_NAMESPACES.EXT, 'ExtensionContent')
        .ele(null, 'CustomTagGeneral')
        .ele(null, 'InformacionNegociacion');

      for (const { name, value } of negotiation_info) {
        negotiation.ele(null, 'Name').txt(name);
        negotiation.ele(null, 'Value').txt(value);
      }
    }

    // Last UBLExtension: placeholder ExtensionContent for the XAdES signature.
    extensions
      .ele(UBL_NAMESPACES.EXT, 'UBLExtension')
      .ele(UBL_NAMESPACES.EXT, 'ExtensionContent');
  }

  /**
   * Builds the DIAN document consultation (QR) URL. Habilitación and production
   * use different catalog hosts.
   */
  static buildQrUrl(
    environment: 'test' | 'production',
    document_key: string,
  ): string {
    const base =
      environment === 'production'
        ? 'https://catalogo-vpfe.dian.gov.co'
        : 'https://catalogo-vpfe-hab.dian.gov.co';
    return `${base}/document/searchqr?documentkey=${document_key}`;
  }

  /**
   * Builds the supplier (emisor) party element.
   *
   * `numbering_prefix` es el prefijo de la resolución de numeración (el mismo
   * que viaja en `sts:AuthorizedInvoices/sts:Prefix`). Identifica el PUNTO DE
   * FACTURACIÓN y va en `cac:PartyLegalEntity/cac:CorporateRegistrationScheme`
   * — ver la nota de FAJ49/FAJ50 más abajo. Es opcional porque el documento
   * soporte construye su emisor a partir de un tercero no obligado a facturar,
   * que no tiene resolución propia: ahí el grupo se omite.
   */
  static buildSupplierParty(
    parent: any,
    issuer: DianIssuerData,
    numbering_prefix?: string,
  ): void {
    const supplier = parent.ele(UBL_NAMESPACES.CAC, 'AccountingSupplierParty');
    // AdditionalAccountID = tipo de persona/organización ('1' Jurídica default,
    // '2' Natural). The tax regime ('48'/'49') belongs in TaxLevelCode, not here.
    supplier
      .ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID')
      .txt(issuer.person_type ?? '1');

    const party = supplier.ele(UBL_NAMESPACES.CAC, 'Party');

    // Party name
    party
      .ele(UBL_NAMESPACES.CAC, 'PartyName')
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(issuer.trade_name || issuer.legal_name);

    // Physical location
    UblCommonBuilder.buildAddress(
      party.ele(UBL_NAMESPACES.CAC, 'PhysicalLocation'),
      issuer,
    );

    // Tax scheme
    const tax_scheme = party.ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(issuer.legal_name);
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', issuer.document_type || '31') // NIT by default
      .txt(issuer.nit);

    // cbc:TaxLevelCode carries the fiscal responsibilities of the issuer (its
    // value, e.g. 'O-13;O-15' or 'R-99-PN'), which already encode the tax
    // regime. Per the DIAN annex (FAJ26/CAJ27) the @listName attribute is the
    // literal 'No aplica'. The regime is NOT emitted as a 48/49 code, and it no
    // longer lives in AdditionalAccountID (which is now the person type).
    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CBC, 'TaxLevelCode');
    tax_level
      .att('listName', 'No aplica')
      .txt(UblCommonBuilder.toTaxLevelCode(issuer.tax_scheme));

    UblCommonBuilder.buildRegistrationAddress(tax_scheme, issuer);

    // `cac:TaxScheme` se valida como PAR (ID, Name). El anexo exige `cbc:Name`
    // junto a `cbc:ID` y la DIAN notifica FAJ41 «el contenido de este elemento
    // no corresponde al nombre y código valido» cuando el nombre falta —
    // XPath `/Invoice/cac:AccountingSupplierParty/…/cac:TaxScheme/cbc:Name`.
    const issuer_scheme = tax_scheme.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
    issuer_scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(DIAN_TAX_CODES.IVA);
    issuer_scheme
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(DIAN_TAX_NAMES[DIAN_TAX_CODES.IVA]);

    // Party legal entity
    const legal = party.ele(UBL_NAMESPACES.CAC, 'PartyLegalEntity');
    legal.ele(UBL_NAMESPACES.CBC, 'RegistrationName').txt(issuer.legal_name);
    legal
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', issuer.nit_dv)
      .att('schemeName', issuer.document_type || '31')
      .txt(issuer.nit);

    // FAJ49 + FAJ50 (espejos CAJ49/CAJ50 en nota crédito y DAJ49/DAJ50 en nota
    // débito, las tres de severidad RECHAZO). `cac:CorporateRegistrationScheme`
    // identifica el PUNTO DE FACTURACIÓN, y de ese punto cuelgan la autorización
    // de numeración y el software habilitado para usarla. El anexo define
    // FAB10a como la comparación
    //
    //   sts:AuthorizedInvoices/sts:Prefix
    //     == cac:PartyLegalEntity/cac:CorporateRegistrationScheme/cbc:ID
    //
    // Sin el grupo no hay lado derecho contra el que comparar, así que la DIAN
    // no resuelve el punto — y en cascada no resuelve la autorización (FAD05e
    // «el número no existe para la autorización») ni el software autorizado
    // para ella (FAB24a presencia, FAB27b huella, FAB25/FAB26 atributos). Es el
    // mismo racimo de un solo XPath ausente que ya produjo FAJ28/29/32 con la
    // dirección fiscal: siete reglas, un elemento.
    //
    // En la vía asincrónica el efecto era peor que un rechazo: la DIAN devolvía
    // ZipKey y no clasificaba el lote en el set de pruebas, así que el portal
    // quedaba en «Recibidos 0» y `GetStatus` respondía código 66 —«TrackId no
    // existe en los registros de la DIAN»— sobre un CUFE que ella misma había
    // validado como correcto por la vía sincrónica.
    //
    // `cbc:Name` (FAJ51) es el número de matrícula mercantil: 6-12 dígitos,
    // 0..1, solo notificación. NO se emite. Vendix no almacena la matrícula, y
    // declarar un número inventado afirmaría un registro que no existe.
    if (numbering_prefix) {
      legal
        .ele(UBL_NAMESPACES.CAC, 'CorporateRegistrationScheme')
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .txt(numbering_prefix);
    }

    // Contact
    if (issuer.email || issuer.phone) {
      const contact = party.ele(UBL_NAMESPACES.CAC, 'Contact');
      if (issuer.phone) {
        contact.ele(UBL_NAMESPACES.CBC, 'Telephone').txt(issuer.phone);
      }
      if (issuer.email) {
        contact.ele(UBL_NAMESPACES.CBC, 'ElectronicMail').txt(issuer.email);
      }
    }
  }

  /**
   * Builds the customer (adquirente) party element — Anexo Técnico 19 compliant.
   *
   * The previous implementation had three defects that DIAN rejects:
   *
   *   1. `@schemeID` carried the verification digit (`customer.document_dv`).
   *      Anexo 19 fixes `@schemeID` to the DIAN document-type code (e.g.
   *      '31' for NIT, '13' for CC) — `@schemeName` is the literal type name
   *      ('NIT', 'CC'). The DV never belongs at `@schemeID`.
   *
   *   2. `cac:PartyLegalEntity` was emitted for every customer, including
   *      personas naturales. UBL distinguishes
   *      `cac:PartyLegalEntity`/`CompanyID` from `cac:Person`/`FirstName`+
   *      `FamilyName` structurally; emitting the legal entity for a natural
   *      person is a rejection (no `RegistrationName` is honest when the
   *      taxpayer is a person).
   *
   *   3. `TaxLevelCode` carried only the first responsibility
   *      (`tax_responsibilities?.[0]`). Anexo 19 accepts `;`-separated
   *      responsibility codes — concatenating all is the conformant form.
   *
   * Fix:
   *
   *   - @schemeID  = DIAN_ID_TYPES[document_type] (DIAN code, not DV).
   *   - @schemeName= document_type literal ('NIT', 'CC', …).
   *   - Structural branch by `person_type`:
   *       JURIDICA  → `cac:PartyLegalEntity` with `cbc:RegistrationName` +
   *                   `cbc:CompanyID`.
   *       NATURAL   → `cac:Person` with `cbc:FirstName` + `cbc:FamilyName` +
   *                   `cbc:ID`.
   *       null      → derive from `document_type` (NIT → JURIDICA, else NATURAL).
   *   - Multiple `cbc:AdditionalAccountID` siblings: person-type code (1/2) +
   *     retenedor markers (gran contribuyente=1 if O-13, autorretenedor=2 if
   *     O-15, agente de retención=3 if is_withholding_agent).
   *   - `cbc:IndustryClassificationCode` emitted when `ciiu_code` is present.
   *   - The verification digit, when present, is emitted alongside the bare
   *     document number in `cbc:CompanyID`/`cbc:ID` as `<NIT>-<DV>` (canonical
   *     Anexo 19 form when `schemeName` already carries the type literal —
   *     keeps the DV explicit without re-using `@schemeID`).
   */
  static buildCustomerParty(parent: any, customer: DianCustomerData): void {
    const customer_party = parent.ele(
      UBL_NAMESPACES.CAC,
      'AccountingCustomerParty',
    );

    // Structural branch selector — see method JSDoc for the rule.
    const resolved_person_type: 'NATURAL' | 'JURIDICA' =
      customer.person_type ??
      (customer.document_type === 'NIT' ? 'JURIDICA' : 'NATURAL');

    const dian_scheme_id =
      DIAN_ID_TYPES[customer.document_type] || customer.document_type;

    // First `cbc:AdditionalAccountID` = person type ('1' Jurídica / '2'
    // Natural). The retenedor markers follow as siblings.
    const person_code = resolved_person_type === 'JURIDICA' ? '1' : '2';
    customer_party.ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID').txt(person_code);

    // Retenedor markers per Anexo 19 — emitted only when applicable. Each is an
    // OWN `cbc:AdditionalAccountID` sibling; the cardinality 1..N allows this.
    const responsibilities = customer.tax_responsibilities ?? [];
    if (responsibilities.includes('O-13')) {
      // Gran contribuyente
      customer_party.ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID').txt('1');
    }
    if (responsibilities.includes('O-15')) {
      // Autorretenedor
      customer_party.ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID').txt('2');
    }
    if (customer.is_withholding_agent) {
      // Agente de retención
      customer_party.ele(UBL_NAMESPACES.CBC, 'AdditionalAccountID').txt('3');
    }

    const party = customer_party.ele(UBL_NAMESPACES.CAC, 'Party');

    // The document-number-with-DV form for `cbc:CompanyID`/`cbc:ID` text
    // content. Bare number when no DV; `<NIT>-<DV>` when present. Using the
    // explicit `<NIT>-<DV>` form (vs. `@schemeName="NIT-DV"`) keeps the DV
    // visible at the XPath DIAN validates and matches the canonical Anexo 19
    // convention: schemeName carries the document type literal, schemeID
    // carries the DIAN code, and the DV rides alongside the value.
    const id_value_with_dv =
      customer.verification_digit && customer.document_number
        ? `${customer.document_number}-${customer.verification_digit}`
        : customer.document_number;

    // `cac:PartyIdentification` es obligatorio cuando el adquiriente es
    // consumidor final, es decir cuando `AdditionalAccountID = "2"`. La DIAN
    // rechaza con FAK61 «Si el valor de AdditionalAccountID es igual a "2" y el
    // grupo no es informado» — XPath
    // `//cac:AccountingCustomerParty/cac:Party/cac:PartyIdentification`.
    //
    // Se emite siempre y no solo para el tipo "2": el documento del adquiriente
    // es información legítima en ambos casos, y condicionarlo al tipo de persona
    // reintroduciría la misma clase de defecto en cuanto el tipo se derive mal.
    // En UBL `PartyIdentification` precede a `PartyName` en la secuencia.
    party
      .ele(UBL_NAMESPACES.CAC, 'PartyIdentification')
      .ele(UBL_NAMESPACES.CBC, 'ID')
      .att('schemeAgencyID', '195')
      .att('schemeAgencyName', UblCommonBuilder.DIAN_SCHEME_AGENCY_NAME)
      .att('schemeID', dian_scheme_id)
      .att('schemeName', customer.document_type)
      .txt(id_value_with_dv);

    // Party name (commercial name when present, else legal name / first+last).
    party
      .ele(UBL_NAMESPACES.CAC, 'PartyName')
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(
        customer.trade_name ||
          customer.legal_name ||
          `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() ||
          'Consumidor Final',
      );

    // Physical location
    if (customer.city_code) {
      UblCommonBuilder.buildAddress(
        party.ele(UBL_NAMESPACES.CAC, 'PhysicalLocation'),
        customer,
      );
    }

    // Tax scheme
    const tax_scheme = party.ele(UBL_NAMESPACES.CAC, 'PartyTaxScheme');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
      .txt(customer.legal_name || '');
    tax_scheme
      .ele(UBL_NAMESPACES.CBC, 'CompanyID')
      .att('schemeAgencyID', '195')
      .att(
        'schemeAgencyName',
        'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
      )
      .att('schemeID', dian_scheme_id)
      .att('schemeName', customer.document_type)
      .txt(id_value_with_dv);

    // cbc:TaxLevelCode — fiscal responsibilities of the acquirer; the
    // @listName is the literal 'No aplica' per the DIAN annex. A consumidor
    // final / natural person reports 'R-99-PN'. ALL responsibilities are
    // concatenated with `;`; `toTaxLevelCode` enforces the closed enumeration
    // and falls back to 'R-99-PN' when the list is empty or invalid.
    const tax_level = tax_scheme.ele(UBL_NAMESPACES.CBC, 'TaxLevelCode');
    tax_level
      .att('listName', 'No aplica')
      .txt(
        UblCommonBuilder.toTaxLevelCode(
          responsibilities.length ? responsibilities.join(';') : 'R-99-PN',
        ),
      );

    if (customer.city_code) {
      UblCommonBuilder.buildRegistrationAddress(tax_scheme, customer);
    }

    const customer_scheme = tax_scheme.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
    customer_scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(DIAN_TAX_CODES.IVA);
    customer_scheme
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .txt(DIAN_TAX_NAMES[DIAN_TAX_CODES.IVA]);

    // CIIU — optional per Anexo 19 (RUT casilla 46, 4 digits).
    if (customer.ciiu_code) {
      party
        .ele(UBL_NAMESPACES.CBC, 'IndustryClassificationCode')
        .txt(customer.ciiu_code);
    }

    // Structural branch — see method JSDoc for the rule.
    if (resolved_person_type === 'JURIDICA') {
      const legal = party.ele(UBL_NAMESPACES.CAC, 'PartyLegalEntity');
      legal
        .ele(UBL_NAMESPACES.CBC, 'RegistrationName')
        .txt(customer.legal_name || '');
      legal
        .ele(UBL_NAMESPACES.CBC, 'CompanyID')
        .att('schemeAgencyID', '195')
        .att(
          'schemeAgencyName',
          'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
        )
        .att('schemeID', dian_scheme_id)
        .att('schemeName', customer.document_type)
        .txt(id_value_with_dv);
    } else {
      // NATURAL — `cac:Person` with FirstName, FamilyName, ID. The two
      // structural siblings (`cac:Person`, `cac:PartyLegalEntity`) are
      // mutually exclusive in UBL for the customer role.
      const person = party.ele(UBL_NAMESPACES.CAC, 'Person');
      person
        .ele(UBL_NAMESPACES.CBC, 'FirstName')
        .txt(customer.first_name || customer.legal_name || '');
      person
        .ele(UBL_NAMESPACES.CBC, 'FamilyName')
        .txt(customer.last_name || '');
      person
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .att('schemeAgencyID', '195')
        .att(
          'schemeAgencyName',
          'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)',
        )
        .att('schemeID', dian_scheme_id)
        .att('schemeName', customer.document_type)
        .txt(id_value_with_dv);
    }

    // Contact
    if (customer.email || customer.phone) {
      const contact = party.ele(UBL_NAMESPACES.CAC, 'Contact');
      if (customer.phone) {
        contact.ele(UBL_NAMESPACES.CBC, 'Telephone').txt(customer.phone);
      }
      if (customer.email) {
        contact.ele(UBL_NAMESPACES.CBC, 'ElectronicMail').txt(customer.email);
      }
    }
  }

  /**
   * `cac:PhysicalLocation` es un `LocationType`: CONTIENE un `cac:Address`.
   *
   * No sirve para `cac:RegistrationAddress`, que ya ES un `AddressType` — para
   * ese usar `buildRegistrationAddress`. Los dos compartían este método y el
   * envoltorio de más dejaba la dirección fiscal del emisor fuera de la ruta
   * donde la DIAN la busca (ver `buildAddressFields`).
   */
  static buildAddress(
    parent: any,
    address: DianAddressFields,
  ): void {
    UblCommonBuilder.buildAddressFields(
      parent.ele(UBL_NAMESPACES.CAC, 'Address'),
      address,
    );
  }

  /**
   * `cac:RegistrationAddress` ES un `AddressType`, así que sus campos cuelgan
   * DIRECTAMENTE de él: los XPath del anexo son
   * `…/cac:PartyTaxScheme/cac:RegistrationAddress/cbc:ID` y
   * `…/cac:RegistrationAddress/cbc:CountrySubentityCode`.
   *
   * Antes se reutilizaba `buildAddress`, que interpone un `cac:Address`. El dato
   * viajaba completo pero un nivel más abajo del que la DIAN consulta, así que
   * los tres XPath resolvían a nada y respondía con tres reglas por una sola
   * causa: FAJ28 «no fue informado el conjunto de elementos …» sobre el grupo,
   * más FAJ29 y FAJ32 «este código no corresponde a un valor válido de la
   * lista» sobre el municipio y el departamento que sí estaban informados.
   */
  static buildRegistrationAddress(
    parent: any,
    address: DianAddressFields,
  ): void {
    UblCommonBuilder.buildAddressFields(
      parent.ele(UBL_NAMESPACES.CAC, 'RegistrationAddress'),
      address,
    );
  }

  /**
   * Emite el conjunto de campos de dirección DENTRO del elemento recibido, sin
   * crear envoltorio. Es el cuerpo común de las dos formas de arriba.
   */
  private static buildAddressFields(
    addr: any,
    address: DianAddressFields,
  ): void {
    addr.ele(UBL_NAMESPACES.CBC, 'ID').txt(address.city_code || '11001');
    addr.ele(UBL_NAMESPACES.CBC, 'CityName').txt(address.city_name || 'Bogotá');
    addr
      .ele(UBL_NAMESPACES.CBC, 'PostalZone')
      .txt(address.postal_code || '110111');
    addr
      .ele(UBL_NAMESPACES.CBC, 'CountrySubentity')
      .txt(address.department_name || 'Bogotá');
    addr
      .ele(UBL_NAMESPACES.CBC, 'CountrySubentityCode')
      .txt(address.department_code || '11');

    addr
      .ele(UBL_NAMESPACES.CAC, 'AddressLine')
      .ele(UBL_NAMESPACES.CBC, 'Line')
      .txt(address.address_line || 'N/A');

    const country = addr.ele(UBL_NAMESPACES.CAC, 'Country');
    country
      .ele(UBL_NAMESPACES.CBC, 'IdentificationCode')
      .txt(address.country_code || 'CO');
    country
      .ele(UBL_NAMESPACES.CBC, 'Name')
      .att('languageID', 'es')
      .txt('Colombia');
  }

  /**
   * Builds tax total elements from invoice taxes.
   */
  static buildTaxTotals(
    parent: any,
    taxes: ProviderInvoiceTax[],
    currency: string,
  ): void {
    // Group taxes by DIAN scheme code (tax_type-aware): IVA→01, INC→04, ICA→03.
    // This is the document-level TaxTotal DIAN validates, so IVA and INC must
    // land in separate TaxSubtotal blocks with their own scheme.
    const tax_groups = new Map<string, ProviderInvoiceTax[]>();
    for (const tax of taxes) {
      const code = UblCommonBuilder.resolveTaxCodeFromTax(tax);
      if (!tax_groups.has(code)) {
        tax_groups.set(code, []);
      }
      tax_groups.get(code)!.push(tax);
    }

    const tax_total = parent.ele(UBL_NAMESPACES.CAC, 'TaxTotal');
    tax_total
      .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
      .att('currencyID', currency)
      .txt(dianSum(taxes.map((t) => t.tax_amount)));

    for (const [code, group_taxes] of tax_groups) {
      const subtotal = tax_total.ele(UBL_NAMESPACES.CAC, 'TaxSubtotal');
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxableAmount')
        .att('currencyID', currency)
        .txt(dianSum(group_taxes.map((t) => t.taxable_amount)));
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(dianSum(group_taxes.map((t) => t.tax_amount)));

      const tax_category = subtotal.ele(UBL_NAMESPACES.CAC, 'TaxCategory');

      // ICA rates are stored in "per mil" (‰) — convert to percentage for UBL.
      // ICA keeps 4 decimals because a 7‰ rate is 0.7000 %, which 2 decimals
      // would flatten; every other scheme uses the DIAN 2-decimal contract.
      const tax_percent =
        code === DIAN_TAX_CODES.ICA
          ? toDecimal(group_taxes[0].tax_rate).dividedBy(10).toFixed(4)
          : dianRate(group_taxes[0].tax_rate);
      tax_category.ele(UBL_NAMESPACES.CBC, 'Percent').txt(tax_percent);

      const scheme = tax_category.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
      scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(code);
      scheme.ele(UBL_NAMESPACES.CBC, 'Name').txt(DIAN_TAX_NAMES[code] || code);
    }
  }

  /**
   * Document-level discount not already represented on the lines.
   *
   * Vendix originates discounts per line (`order_items.discount_amount`), so in
   * the normal case this is zero. It is non-zero only when the document carries a
   * footer discount that no line accounts for — e.g. a conditional discount
   * (Anexo §13.2.8.8) — and that is the only case where a document-level
   * `cac:AllowanceCharge` is legitimate.
   */
  private static documentDiscount(data: {
    discount_amount: string;
    items: ProviderInvoiceItem[];
  }): string {
    const line_discounts = dianSum(
      data.items.map((item) => item.discount_amount),
    );
    const remainder = toDecimal(data.discount_amount).minus(
      toDecimal(line_discounts),
    );
    // A negative remainder means the lines already discount more than the
    // document total claims — never emit a negative allowance, which the DIAN
    // rejects; the line-level truth wins.
    return remainder.isNegative() ? dianAmount(0) : dianAmount(remainder);
  }

  /**
   * Emits the document-level `cac:AllowanceCharge` backing
   * `AllowanceTotalAmount`, and only when there is something to back.
   *
   * The Anexo requires every document allowance to be supported by an
   * `AllowanceCharge`; emitting `AllowanceTotalAmount` alone (which is what this
   * codebase used to do) leaves an unsupported allowance. Must be called BEFORE
   * `buildTaxTotals` because UBL fixes the element order
   * `PaymentTerms → AllowanceCharge → TaxTotal → LegalMonetaryTotal`.
   */
  static buildDocumentAllowanceCharge(
    parent: any,
    data: { discount_amount: string; items: ProviderInvoiceItem[] },
    currency: string,
  ): void {
    const discount = UblCommonBuilder.documentDiscount(data);
    if (toDecimal(discount).isZero()) return;

    const line_extension = dianLineExtensionTotal(data.items);
    const allowance = parent.ele(UBL_NAMESPACES.CAC, 'AllowanceCharge');
    allowance.ele(UBL_NAMESPACES.CBC, 'ID').txt('1');
    // false = allowance (discount); true would make it a charge.
    allowance.ele(UBL_NAMESPACES.CBC, 'ChargeIndicator').txt('false');
    allowance
      .ele(UBL_NAMESPACES.CBC, 'AllowanceChargeReason')
      .txt('Descuento a nivel de documento');
    allowance
      .ele(UBL_NAMESPACES.CBC, 'Amount')
      .att('currencyID', currency)
      .txt(discount);
    allowance
      .ele(UBL_NAMESPACES.CBC, 'BaseAmount')
      .att('currencyID', currency)
      .txt(line_extension);
  }

  /**
   * Builds `cac:PaymentMeans`, the payment group the DIAN requires on every
   * document with cardinality `1..N`.
   *
   * WHY THIS IS SHARED AND NOT INLINE
   *
   * The invoice, the equivalent document and the support document each grew
   * their own inline copy of this block, and the two notes grew NONE. The DIAN
   * rejected all 20 notes of the habilitación set for exactly that:
   *
   *   CAN01  «Rechazo si grupo no informado»  /CreditNote/cac:PaymentMeans
   *   DAN01  «Rechazo si grupo no informado»  /DebitNote/cac:PaymentMeans
   *
   * A group that four document types need is not a per-builder detail. The two
   * notes consume it from here so a fifth omission cannot happen the same way.
   *
   * The three existing inline copies are deliberately NOT migrated in this
   * change: they are the code path the DIAN accepted 30 times during the
   * habilitación, and this ships against a live habilitación that must not
   * regress. Migrating them is a separate, independently verifiable change.
   *
   * UBL fixes the order `Delivery → DeliveryTerms → PaymentMeans →
   * PaymentTerms → AllowanceCharge → TaxTotal → (monetary total)`, so callers
   * must invoke this AFTER the parties and BEFORE the tax totals.
   *
   * Field defaults follow the same convention the invoice builder already uses:
   * `payment_form` '1' = contado, `payment_means` '10' = efectivo. `DAN04`
   * makes `PaymentDueDate` mandatory on credit sales, so it is always emitted,
   * falling back to the issue date when no due date exists.
   */
  static buildPaymentMeans(
    parent: any,
    data: {
      payment_form?: string;
      payment_means?: string;
      due_date?: string;
      issue_date: string;
    },
  ): void {
    const payment_means = parent.ele(UBL_NAMESPACES.CAC, 'PaymentMeans');
    payment_means.ele(UBL_NAMESPACES.CBC, 'ID').txt(data.payment_form || '1');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentMeansCode')
      .txt(data.payment_means || '10');
    payment_means
      .ele(UBL_NAMESPACES.CBC, 'PaymentDueDate')
      .txt(data.due_date || data.issue_date);
  }

  /**
   * Builds the document's monetary-total group so it satisfies the DIAN
   * arithmetic rules.
   *
   * The defect this replaces: the header published the GROSS subtotal as
   * `LineExtensionAmount` while every line published its NET amount
   * (`qty × price − discount`), so any invoice carrying a discount broke rule
   * `FAU14` (header ≠ Σ lines) and was rejected. `TaxExclusiveAmount` carried the
   * same gross value even though the taxable base is net, and
   * `AllowanceTotalAmount` restated a discount the lines had already applied.
   *
   * Invariants enforced here:
   * - `LineExtensionAmount` = Σ line `LineExtensionAmount` (same function, so
   *   the two cannot drift) — rule `FAU14`.
   * - `TaxExclusiveAmount` = net taxable base.
   * - `TaxInclusiveAmount` = net base + taxes.
   * - `PayableAmount` = `TaxInclusiveAmount − AllowanceTotalAmount`, computed
   *   rather than copied, so the identity holds by construction.
   *
   * Shared by invoice, credit note, debit note and support document — the block
   * was duplicated four times and drifted independently.
   *
   * THE WRAPPER ELEMENT IS NOT THE SAME FOR EVERY DOCUMENT. UBL 2.1 names the
   * debit note's group `cac:RequestedMonetaryTotal`; every other document uses
   * `cac:LegalMonetaryTotal`. It is not a synonym and not a mirror — the DIAN
   * publishes a different XPath per document type (Anexo Técnico 1.9 §11.4.6):
   *
   *   CAU01  /CreditNote/cac:LegalMonetaryTotal
   *   DAU01  /DebitNote/cac:RequestedMonetaryTotal        <- 1..1, obligatorio
   *
   * Emitting `LegalMonetaryTotal` inside a `DebitNote` therefore publishes the
   * amounts where nothing reads them. That single wrong name produced FOUR
   * rejections at once on all 10 debit notes of the set, because the CUDE and
   * the arithmetic rules both resolve through it:
   *
   *   DAD06  CUDE mal calculado — ValFac and ValTot resolve to
   *          /DebitNote/cac:RequestedMonetaryTotal/{LineExtensionAmount,PayableAmount};
   *          absent, the DIAN hashes empty strings and gets another key
   *   DAU02  bruto no cuadra con las líneas
   *   DAU04  base imponible no cuadra
   *   DAU06  bruto + tributos no cuadra
   *
   * The arithmetic was never wrong: it is the same function that backed the 30
   * accepted invoices. Only the envelope was misnamed.
   */
  static buildMonetaryTotal(
    parent: any,
    data: {
      discount_amount: string;
      tax_amount: string;
      items: ProviderInvoiceItem[];
    },
    currency: string,
    /**
     * UBL name of the group. Defaults to `LegalMonetaryTotal`, which is correct
     * for every document type EXCEPT the debit note.
     */
    element_name:
      | 'LegalMonetaryTotal'
      | 'RequestedMonetaryTotal' = 'LegalMonetaryTotal',
  ): void {
    const line_extension = dianLineExtensionTotal(data.items);
    const document_discount = UblCommonBuilder.documentDiscount(data);
    const tax_inclusive = dianArithmetic([
      { value: line_extension, sign: 1 },
      { value: data.tax_amount, sign: 1 },
    ]);
    const payable = dianArithmetic([
      { value: tax_inclusive, sign: 1 },
      { value: document_discount, sign: -1 },
    ]);

    const monetary = parent.ele(UBL_NAMESPACES.CAC, element_name);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
      .att('currencyID', currency)
      .txt(line_extension);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxExclusiveAmount')
      .att('currencyID', currency)
      .txt(line_extension);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'TaxInclusiveAmount')
      .att('currencyID', currency)
      .txt(tax_inclusive);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'AllowanceTotalAmount')
      .att('currencyID', currency)
      .txt(document_discount);
    monetary
      .ele(UBL_NAMESPACES.CBC, 'PayableAmount')
      .att('currencyID', currency)
      .txt(payable);
  }

  /**
   * `cac:LegalMonetaryTotal` — the group name every document uses EXCEPT the
   * debit note. Kept as the named entry point so the four callers that are
   * legitimately `LegalMonetaryTotal` (invoice, credit note, equivalent document,
   * support document) read as a statement of which group they emit rather than
   * as a default they happen to inherit.
   */
  static buildLegalMonetaryTotal(
    parent: any,
    data: {
      discount_amount: string;
      tax_amount: string;
      items: ProviderInvoiceItem[];
    },
    currency: string,
  ): void {
    UblCommonBuilder.buildMonetaryTotal(
      parent,
      data,
      currency,
      'LegalMonetaryTotal',
    );
  }

  /**
   * `cac:RequestedMonetaryTotal` — the debit note's group, and ONLY the debit
   * note's. See `buildMonetaryTotal` for why using the wrong one costs four
   * rejection rules (DAD06, DAU02, DAU04, DAU06) at once.
   */
  static buildRequestedMonetaryTotal(
    parent: any,
    data: {
      discount_amount: string;
      tax_amount: string;
      items: ProviderInvoiceItem[];
    },
    currency: string,
  ): void {
    UblCommonBuilder.buildMonetaryTotal(
      parent,
      data,
      currency,
      'RequestedMonetaryTotal',
    );
  }

  /**
   * Builds invoice line items.
   */
  static buildInvoiceLines(
    parent: any,
    items: ProviderInvoiceItem[],
    taxes: ProviderInvoiceTax[],
    currency: string,
  ): void {
    UblCommonBuilder.buildDocumentLines(parent, items, taxes, currency, {
      line_element: 'InvoiceLine',
      quantity_element: 'InvoicedQuantity',
    });
  }

  /**
   * Emite las líneas de un documento —cantidad, descuento, `cac:TaxTotal` de
   * línea, ítem y precio— para los tres tipos que comparten estructura en UBL.
   *
   * `InvoiceLineType`, `CreditNoteLineType` y `DebitNoteLineType` difieren SOLO
   * en el nombre del elemento de cantidad (`InvoicedQuantity` /
   * `CreditedQuantity` / `DebitedQuantity`); el resto de la secuencia UBL es
   * idéntico, incluido el orden `AllowanceCharge → TaxTotal → Item → Price`.
   *
   * Antes cada builder escribía su propia línea, y esa duplicación ya dejó
   * arreglos afuera dos veces:
   *
   *   - FAZ09 (`cac:StandardItemIdentification`) se arregló en la factura y hubo
   *     que replicarlo a mano en las notas.
   *   - `cac:TaxTotal` de línea nunca llegó a ellas — reglas CAS01b y DAS01b,
   *     que alcanzan a 20 de los 50 documentos que exige el set de habilitación.
   *
   * Un solo cuerpo hace imposible que la próxima regla alcance a un tipo de
   * documento y no a los otros.
   */
  static buildDocumentLines(
    parent: any,
    items: ProviderInvoiceItem[],
    taxes: ProviderInvoiceTax[],
    currency: string,
    options: {
      line_element: 'InvoiceLine' | 'CreditNoteLine' | 'DebitNoteLine';
      quantity_element:
        | 'InvoicedQuantity'
        | 'CreditedQuantity'
        | 'DebitedQuantity';
    },
  ): void {
    items.forEach((item, index) => {
      const line = parent.ele(UBL_NAMESPACES.CAC, options.line_element);
      line.ele(UBL_NAMESPACES.CBC, 'ID').txt(String(index + 1));

      line
        .ele(UBL_NAMESPACES.CBC, options.quantity_element)
        // Unidad realmente vendida; `EA` (each) cuando el producto no declara
        // unidad, que es todo el catálogo por pieza.
        .att('unitCode', item.unit_code || 'EA')
        .txt(item.quantity);

      // Same function the header uses, so header and lines cannot disagree.
      line
        .ele(UBL_NAMESPACES.CBC, 'LineExtensionAmount')
        .att('currencyID', currency)
        .txt(dianLineExtension(item));

      // Allowance/charge for discount
      if (!toDecimal(item.discount_amount).isZero()) {
        const allowance = line.ele(UBL_NAMESPACES.CAC, 'AllowanceCharge');
        allowance.ele(UBL_NAMESPACES.CBC, 'ChargeIndicator').txt('false');
        allowance
          .ele(UBL_NAMESPACES.CBC, 'Amount')
          .att('currencyID', currency)
          .txt(dianAmount(item.discount_amount));
        // Importe sobre el que se calculó el descuento: la línea ANTES de
        // restarlo. Se deriva del mismo helper que el importe neto para que
        // lleve el divisor de la *price unit*; escrito a mano como
        // `cantidad × precio` declaraba una base N veces mayor que el
        // `cbc:LineExtensionAmount` de su propia línea.
        allowance
          .ele(UBL_NAMESPACES.CBC, 'BaseAmount')
          .att('currencyID', currency)
          .txt(dianLineGross(item));
      }

      // Tax total for line
      const line_tax_total = line.ele(UBL_NAMESPACES.CAC, 'TaxTotal');
      line_tax_total
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(dianAmount(item.tax_amount));

      // Line-level tax code/rate. invoice_taxes is header-level (not persisted
      // per item), so a line inherits the invoice's primary tax. The code is
      // resolved tax_type-first for correctness on single-tax invoices (a pure
      // INC restaurant bill emits scheme 04, not 01). Mixed IVA+INC invoices
      // are reconciled at the authoritative document-level TaxTotal above.
      const tax_rate = taxes.length > 0 ? taxes[0].tax_rate : '19.00';
      const tax_code =
        taxes.length > 0
          ? UblCommonBuilder.resolveTaxCodeFromTax(taxes[0])
          : DIAN_TAX_CODES.IVA;

      const subtotal = line_tax_total.ele(UBL_NAMESPACES.CAC, 'TaxSubtotal');
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxableAmount')
        .att('currencyID', currency)
        .txt(dianLineExtension(item));
      subtotal
        .ele(UBL_NAMESPACES.CBC, 'TaxAmount')
        .att('currencyID', currency)
        .txt(dianAmount(item.tax_amount));

      const category = subtotal.ele(UBL_NAMESPACES.CAC, 'TaxCategory');
      // dianRate, not the raw string: tax_rate arrives from a Decimal(5,2), so
      // 19.00 serialized as '19' and reached the XML without decimals.
      category.ele(UBL_NAMESPACES.CBC, 'Percent').txt(dianRate(tax_rate));
      // Mismo par (ID, Name) que en la cabecera. FAS01b compara «Porcentaje,
      // Nombre y ID» de la línea contra el TaxTotal de cabecera para exigir que
      // exista uno por cada tributo de línea «con las características
      // correspondiente al mismo impuesto». La cabecera sí emitía el nombre y la
      // línea no, así que la línea no coincidía con su propio impuesto.
      const line_scheme = category.ele(UBL_NAMESPACES.CAC, 'TaxScheme');
      line_scheme.ele(UBL_NAMESPACES.CBC, 'ID').txt(tax_code);
      line_scheme
        .ele(UBL_NAMESPACES.CBC, 'Name')
        .txt(DIAN_TAX_NAMES[tax_code] || tax_code);

      // Item description + identificación estándar del ítem.
      //
      // `cac:StandardItemIdentification` es obligatorio: la DIAN rechaza la línea
      // sin él con la regla FAZ09 «StandardItemIdentification no informado». No se
      // emitía en ningún tipo de documento, así que el defecto alcanzaba también a
      // la emisión real, no solo a la habilitación.
      //
      // `schemeID="999"` = «estándar de adopción del contribuyente». Es el valor
      // correcto mientras Vendix no publique catálogo UNSPSC (001) ni GTIN (010):
      // declarar uno de esos sin tenerlo sería una afirmación falsa sobre el
      // origen del código. El número de línea es la caída cuando el llamador no
      // aporta código — identifica el ítem dentro del documento, que es lo que la
      // regla pide, sin inventar un catálogo que no existe.
      const ubl_item = line.ele(UBL_NAMESPACES.CAC, 'Item');
      ubl_item.ele(UBL_NAMESPACES.CBC, 'Description').txt(item.description);
      ubl_item
        .ele(UBL_NAMESPACES.CAC, 'StandardItemIdentification')
        .ele(UBL_NAMESPACES.CBC, 'ID')
        .att('schemeID', UBL_CONSTANTS.ITEM_IDENTIFICATION_SCHEME_ID)
        .txt(item.item_code?.trim() || String(index + 1));

      // Price
      const price = line.ele(UBL_NAMESPACES.CAC, 'Price');
      price
        .ele(UBL_NAMESPACES.CBC, 'PriceAmount')
        .att('currencyID', currency)
        // `dianUnitPrice`, no `dianAmount`: este campo admite 0-6 decimales y el
        // precio despejado de una línea con impuesto incluido los necesita. Un
        // precio redondo se sigue emitiendo con 2, así que ningún documento del
        // histórico cambia. Ver la regla FAV06 en `clearInclusiveLine`: el
        // importe de la línea se valida contra ESTE número.
        .txt(dianUnitPrice(item.unit_price));
      // `BaseQuantity` declara a cuánta cantidad aplica `PriceAmount`. Para un
      // producto que publica su precio por N unidades de stock es N, no 1: con
      // `1.00` el documento afirma "$28.000 por gramo" en vez de "por kilo".
      price
        .ele(UBL_NAMESPACES.CBC, 'BaseQuantity')
        .att('unitCode', item.unit_code || 'EA')
        .txt(dianAmount(UblCommonBuilder.resolveBaseQuantity(item)));
    });
  }

  /**
   * `cac:Price/cbc:BaseQuantity` — la cantidad a la que aplica `PriceAmount`.
   *
   * Saneado igual que el divisor del importe de línea (`dian-money.util.ts`):
   * solo un valor > 1 cuenta como escala; ausente, 0, negativo o no numérico
   * devuelve 1, que es el comportamiento histórico de todo el catálogo por
   * pieza. Un `0.00` acá sería peor que el defecto que corrige.
   */
  static resolveBaseQuantity(item: { price_unit_quantity?: string }): number {
    const n = Number(item.price_unit_quantity ?? 1);
    return Number.isFinite(n) && n > 1 ? n : 1;
  }

  /**
   * Resolves a tax name (IVA, INC, ICA) to its DIAN code.
   */
  static resolveTaxCode(tax_name: string): string {
    const name = tax_name.toUpperCase().trim();
    if (name.includes('IVA') || name.includes('VAT')) {
      return DIAN_TAX_CODES.IVA;
    }
    if (name.includes('INC') || name.includes('CONSUMO')) {
      return DIAN_TAX_CODES.INC;
    }
    if (name.includes('ICA')) {
      return DIAN_TAX_CODES.ICA;
    }
    return DIAN_TAX_CODES.IVA; // Default
  }

  /**
   * Resolves the DIAN tax scheme code for a tax row, prioritizing the persisted
   * fiscal type over the tax_name heuristic. This makes IVA (01), INC (04) and
   * ICA (03) deterministic regardless of how the tax was named by the user.
   */
  static resolveTaxCodeFromTax(tax: ProviderInvoiceTax): string {
    switch ((tax.tax_type || '').toLowerCase()) {
      case 'iva':
        return DIAN_TAX_CODES.IVA;
      case 'inc':
        return DIAN_TAX_CODES.INC;
      case 'ica':
        return DIAN_TAX_CODES.ICA;
      default:
        return UblCommonBuilder.resolveTaxCode(tax.tax_name);
    }
  }

  /**
   * Generates the SoftwareSecurityCode hash.
   * SHA-384(software_id + pin + invoice_number)
   */
  static generateSoftwareSecurityCode(
    software_id: string,
    pin: string,
    invoice_number: string,
  ): string {
    const raw = software_id + pin + invoice_number;
    return createHash('sha384').update(raw).digest('hex');
  }
}
