import { Injectable, Logger } from '@nestjs/common';
import { DOMParser } from '@xmldom/xmldom';

import { ErrorCodes, VendixHttpException } from '@common/errors';

import {
  DIAN_TAX_CODES,
  DIAN_TAX_NAMES,
  isDianTaxSchemeCode,
} from '../providers/dian-direct/constants/dian-tax-codes';
import {
  DIAN_DOCUMENT_TYPES,
  DIAN_INVOICE_OPERATION_TYPES,
} from '../providers/dian-direct/constants/dian-document-types';
import { DIAN_UNIT_CODES } from '../providers/dian-direct/constants/dian-unit-codes';
import {
  DianCustomerData,
  DianInvoiceControl,
  DianIssuerData,
  DianSoftwareSecurity,
} from '../providers/dian-direct/interfaces/dian-config.interface';
import {
  buildAiuNote,
  DIAN_AIU_NOTE_MAX_LENGTH,
  DIAN_AIU_NOTE_MIN_LENGTH,
  DIAN_AIU_NOTE_PREFIX,
  UblDocumentLine,
} from '../providers/dian-direct/xml/ubl-common.builder';
import { UblInvoiceBuilder } from '../providers/dian-direct/xml/ubl-invoice.builder';
import {
  DianTotalsValidator,
  DianTotalsViolation,
} from '../providers/dian-direct/xml/dian-totals.validator';
import {
  UblStructureValidator,
  UblStructureViolation,
} from '../providers/dian-direct/xml/ubl-structure.validator';
import { ProviderInvoiceTax } from '../providers/invoice-provider.interface';
import {
  AiuComponent,
  CalculatedAiu,
  CalculatedLine,
  InvoiceCalculatorLineInput,
  InvoiceCalculatorResult,
  InvoiceCalculatorService,
} from '../services/invoice-calculator.service';
import { dianAmount, toDecimal } from '../utils/dian-money.util';

import {
  AiuBucket,
  AiuComponentLiteral,
  AiuVatRegimeLiteral,
  InvoiceProfileConfig,
  ProfileTaxRule,
  regimeFromTaxableBasis,
  resolveAiuComponentsBasis,
  resolveAiuTaxableBasis,
} from './invoice-profile-config.contract';
import {
  PREVIEW_CUFE,
  PREVIEW_INVOICE_NUMBER,
} from './preview-numbering.guard';
import { PreviewProfileDto, PreviewProfileLineDto } from './dto/preview-profile.dto';
import { ProfilesService } from './profiles.service';

/**
 * Emisor de MUESTRA del XML proyectado.
 *
 * ## Por qué la previsualización NO resuelve la identidad fiscal real
 *
 * Podría: `resolveIssuerFiscalIdentity` existe y es la fuente única. Se decidió
 * que no, por dos razones que apuntan al mismo sitio.
 *
 * 1. **Ese resolvedor LANZA** cuando falta el municipio DIAN, la razón social o
 *    el departamento — con toda la razón, porque emitir sin ellos es un rechazo.
 *    Pero una previsualización que se niegue a existir porque el RUT está a
 *    medio llenar es inútil justo cuando más se necesita: el operador está
 *    configurando, no facturando. ADR-5 lo dice explícitamente — el preview tiene
 *    que funcionar en una tienda sin habilitación DIAN.
 * 2. **El emisor no es lo que se está previsualizando.** Lo que el perfil decide
 *    son las líneas, la matriz de tarifas, la gravabilidad por componente, la
 *    nota del contrato y los totales. La identidad del emisor no cambia con el
 *    perfil, así que mostrarla no informa de nada y equivocarla sí desinforma.
 *
 * Los valores son deliberadamente **imposibles de confundir con datos reales**.
 * Un NIT de relleno plausible (`900123456`) en un XML que se filtre a un log o a
 * una captura de pantalla es indistinguible de una emisión verdadera; `PREVIEW`
 * no se confunde con nada. Es el mismo criterio de `PREVIEW_INVOICE_NUMBER`.
 */
const PREVIEW_ISSUER: DianIssuerData = {
  document_type: '31',
  nit: 'PREVIEW',
  nit_dv: '0',
  legal_name: 'EMISOR DE MUESTRA (PREVISUALIZACIÓN)',
  address_line: 'Dirección de muestra',
  city_code: '11001',
  city_name: 'Bogotá D.C.',
  department_code: '11',
  department_name: 'Bogotá D.C.',
  country_code: 'CO',
  email: 'preview@vendix.invalid',
  tax_regime: '48',
  tax_scheme: 'R-99-PN',
  person_type: '1',
};

/** Adquiriente de muestra. Mismo criterio que `PREVIEW_ISSUER`. */
const PREVIEW_CUSTOMER: DianCustomerData = {
  // '31' = NIT en la tabla 13.2.1 del anexo. La SIGLA no es el código: el
  // builder la escribiría tal cual en `cbc:CompanyID/@schemeName` y la DIAN
  // rechaza el documento por catálogo.
  document_type: '31',
  document_number: 'PREVIEW',
  verification_digit: '0',
  legal_name: 'ADQUIRIENTE DE MUESTRA (PREVISUALIZACIÓN)',
  address_line: 'Dirección de muestra',
  city_code: '11001',
  city_name: 'Bogotá D.C.',
  department_code: '11',
  department_name: 'Bogotá D.C.',
  country_code: 'CO',
  email: 'preview@vendix.invalid',
  tax_responsibilities: ['R-99-PN'],
  /**
   * `'JURIDICA'` explícito, no `null`.
   *
   * `null` le pide al builder DERIVAR el tipo de persona desde
   * `document_type`, y esa derivación es ESTRUCTURAL: para una persona natural
   * el documento no lleva `cac:PartyLegalEntity`, y emitirlo donde no
   * corresponde es un defecto de rechazo del Anexo 19. Una previsualización que
   * dejara al builder derivar mostraría una estructura que depende de un dato de
   * relleno, así que se fija la rama y se declara cuál se está enseñando.
   */
  person_type: 'JURIDICA',
  /** Sin CIIU: el grupo es opcional y no hay uno de muestra que no sea inventado. */
  ciiu_code: null,
};

/**
 * Bloque de seguridad del software, MARCADO.
 *
 * El `software_security_code` real es un SHA-384 de `software_id + PIN +
 * consecutivo`. Los tres insumos son datos que la previsualización no tiene —el
 * PIN es secreto y el consecutivo no existe— y calcular el hash con relleno
 * produciría 96 hex con la apariencia exacta de un código válido. La cadena dice
 * qué es.
 */
const PREVIEW_SOFTWARE_SECURITY: DianSoftwareSecurity = {
  software_id: 'PREVIEW',
  software_pin: 'PREVIEW',
  software_security_code: 'PREVIEW-SIN-FIRMA-NO-TRANSMITIDO',
};

/**
 * `sts:InvoiceControl` de muestra.
 *
 * ## Por qué NO se lee la resolución real, ni siquiera para leer
 *
 * Sería una lectura inofensiva en apariencia, pero la resolución que usará la
 * emisión se elige por `(accounting_entity_id, document_type)` y bajo un lock, en
 * el momento de emitir. La entidad contable depende del alcance fiscal de la
 * factura real, que una previsualización de PERFIL no conoce. Elegir una por
 * cuenta propia mostraría un prefijo y una autorización que la emisión puede no
 * usar — y un prefijo equivocado con apariencia de real es peor que uno marcado,
 * porque el operador lo reconoce y le cree.
 *
 * Efecto colateral deseable: la previsualización no toca `invoice_resolutions` en
 * absoluto, ni para leer. Eso hace que el invariante DB-10 sea más fuerte que
 * «no escribe»: la tabla no participa.
 */
const PREVIEW_CONTROL: DianInvoiceControl = {
  invoice_authorization: 'PREVIEW',
  authorization_start_date: '1900-01-01',
  authorization_end_date: '1900-01-01',
  prefix: 'PREVIEW',
  range_from: '0',
  range_to: '0',
};

/** `tax_type` del calculador, por código de tributo de la tabla 13.2.2. */
const TAX_TYPE_BY_DIAN_CODE: Readonly<Record<string, string>> = {
  [DIAN_TAX_CODES.IVA]: 'iva',
  [DIAN_TAX_CODES.INC]: 'inc',
  [DIAN_TAX_CODES.ICA]: 'ica',
};

/** Códigos de unidad UN/ECE conocidos, para la validación de la muestra. */
const KNOWN_UNIT_CODES: ReadonlySet<string> = new Set(
  Object.values(DIAN_UNIT_CODES),
);

/** Unidad por omisión de una línea de muestra: servicio, no pieza. */
const PREVIEW_DEFAULT_UNIT_CODE = DIAN_UNIT_CODES.EACH;

/** Descripción por omisión, por bucket, cuando la muestra no trae una. */
const BUCKET_DEFAULT_DESCRIPTION: Readonly<Record<AiuBucket, string>> = {
  administracion: 'Administración',
  imprevistos: 'Imprevistos',
  utilidad: 'Utilidad',
  costo: 'Costo reembolsable',
};

/**
 * Los tres componentes del AIU en el orden del **anexo**, que es el orden en el
 * que se emiten las líneas: Administración primero, porque es la que lleva la
 * nota CAV03 y la que el operador busca.
 *
 * Es una tupla literal y no `Object.keys(config.aiu.components)`: el orden de
 * iteración de un objeto viene del JSON persistido y dos snapshots con las
 * mismas cifras podrían recorrerse distinto. Ese orden decide a dónde cae el
 * céntimo residual (ver {@link AIU_RESIDUE_PRIORITY}), así que tomarlo del dato
 * haría que la misma entrada produjera dos muestras distintas.
 */
const AIU_EMISSION_ORDER: readonly AiuComponentLiteral[] = [
  'administracion',
  'imprevistos',
  'utilidad',
];

/**
 * Orden de desempate del céntimo residual del reparto AIU: **utilidad primero**.
 *
 * El reparto por resto mayor decide por sí solo en cuanto las partes
 * fraccionarias difieren; esta tupla sólo interviene cuando dos componentes
 * empatan al céntimo (33,33 / 33,33 / 33,34 empata Administración con
 * Imprevistos). Existe por dos razones:
 *
 * · **Determinismo.** Es un literal, no el orden de claves de un objeto: la
 *   misma entrada da siempre la misma muestra, y ningún reordenamiento del JSON
 *   persistido puede moverla.
 * · **Dirección fiscal segura.** La utilidad es la única porción gravable bajo
 *   las TRES bases (`'aiu'`, `'utilidad'` y `'subtotal'`). Bajo `'aiu'` y
 *   `'subtotal'` la base ya contiene el AIU completo, así que el destino del
 *   céntimo no mueve la base ni un peso; sólo importa bajo `'utilidad'`, y ahí
 *   sumarlo declara un céntimo MÁS —el lado recuperable con nota crédito—
 *   mientras dárselo a un componente no gravable declararía de menos, que ante
 *   la DIAN es sanción e intereses.
 *
 * NO es la misma regla que aplica la captura de la factura real
 * (`invoice-create-page.component.ts`, `aiuApplyPlan`): esa pantalla le da el
 * 100 % del residuo a Utilidad sin desempate por resto mayor, mientras que
 * aquí se reparte céntimo a céntimo por resto mayor y sólo el empate cae en
 * esta prioridad. El algoritmo de este archivo es el correcto — no cambiarlo
 * para "alinearlo" con `aiuApplyPlan`; si algo se alinea, es al revés.
 */
const AIU_RESIDUE_PRIORITY: readonly AiuComponentLiteral[] = [
  'utilidad',
  'administracion',
  'imprevistos',
];

/** Un céntimo, la unidad en la que se reparte el residuo del truncamiento. */
const ONE_CENT = toDecimal('0.01');

/** Severidad de una validación del informe. */
export type PreviewValidationSeverity = 'blocker' | 'warning' | 'info';

/**
 * Una regla evaluada sobre el XML proyectado.
 *
 * `code` lleva el código de error que **bloquearía la emisión real** cuando la
 * regla falla, o `null` cuando la regla es informativa. Es lo que permite al
 * editor decir «esto no se podrá emitir, y el motivo es éste» en vez de mostrar
 * un aviso genérico, y lo que ata cada validación de la previsualización a la
 * compuerta que de verdad la hace cumplir en el camino de emisión.
 */
export interface ProfilePreviewValidation {
  /** Regla del Anexo Técnico o invariante interno: `FAU04`, `CAV03`, `AIU-MIN`… */
  rule: string;
  passed: boolean;
  severity: PreviewValidationSeverity;
  /** Código de error de la compuerta real, o `null` si es informativa. */
  code: string | null;
  message: string;
  details?: Record<string, unknown>;
}

/** Una línea del desglose devuelto al editor. */
export interface ProfilePreviewLine {
  index: number;
  bucket: AiuBucket;
  description: string;
  unit_code: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  /** `cbc:LineExtensionAmount` — la base gravable de la línea. */
  line_extension_amount: string;
  tax_amount: string;
  total_amount: string;
  taxes: Array<{
    dian_tax_code: string;
    tax_name: string;
    tax_rate: string;
    taxable_amount: string;
    tax_amount: string;
  }>;
  /** `true` ⇒ la línea NO emite `cac:TaxTotal` (FAX01/CAX01). */
  omit_tax_total: boolean;
  /** `cbc:Note` de línea. Sólo la de Administración en un contrato AIU. */
  note: string | null;
}

/** El resultado completo de una previsualización. */
export interface ProfilePreviewResult {
  profile: {
    id: number;
    name: string;
    operation_type: string;
    version: number;
  };
  /**
   * Declaración explícita de lo que NO ocurrió. Viaja en la respuesta —no sólo
   * en la documentación— para que el cliente pueda mostrarlo y para que una
   * verificación por `curl` lo pueda afirmar sin leer el código.
   */
  not_performed: {
    numbering_reserved: false;
    signed: false;
    transmitted: false;
    persisted: false;
  };
  xml: string;
  breakdown: {
    lines: ProfilePreviewLine[];
    totals: {
      line_extension_amount: string;
      discount_amount: string;
      tax_exclusive_amount: string;
      tax_amount: string;
      tax_inclusive_amount: string;
      payable_amount: string;
    };
  };
  /**
   * Resumen AIU del cálculo, más la nota CAV03 proyectada.
   *
   * `taxable_basis` (dentro de {@link CalculatedAiu}) es la respuesta viva: es
   * lo que decide qué porciones del contrato gravan, y la única capaz de
   * expresar `'subtotal'`. `regime` viaja al lado por la MISMA razón que en
   * `invoices.aiu_taxable_matrix`: el panel que consume esta previsualización se
   * escribió contra `regime`, y quitarlo de golpe le dejaba `undefined` en la
   * casilla donde muestra la base gravable del documento proyectado.
   *
   * Vale `null` bajo `'subtotal'`, que no tiene régimen legal al que citar —no
   * el literal `'subtotal'`, que un lector viejo trataría como régimen
   * desconocido—. Se retira cuando no queden lectores de `regime`, nunca antes.
   */
  aiu_summary:
    | (CalculatedAiu & {
        note: string | null;
        regime: AiuVatRegimeLiteral | null;
      })
    | null;
  validations: ProfilePreviewValidation[];
}

/**
 * PREVISUALIZACIÓN DEL XML QUE PRODUCIRÍA UN PERFIL — ADR-5, paso D.1.
 *
 * ## Qué hace y qué no hace
 *
 * Corre el MISMO cálculo (`InvoiceCalculatorService`) y el MISMO constructor UBL
 * (`UblInvoiceBuilder`) que la emisión real, sobre una factura de muestra, y
 * devuelve el XML proyectado con su desglose y las reglas del anexo evaluadas.
 *
 * **No numera** (el consecutivo es `PREVIEW_INVOICE_NUMBER`, y el token del
 * generador está sustituido por `PreviewNumberingGuard` en todo el módulo),
 * **no firma** (no toca el certificado ni XAdES), **no transmite** (no hay
 * cliente SOAP en el grafo de este servicio) y **no persiste** (no abre ninguna
 * transacción; la única escritura posible del módulo son las siete acciones
 * auditadas de `ProfilesService`, y ninguna se invoca desde acá).
 *
 * ## Por qué reutiliza el calculador en vez de calcular por su cuenta
 *
 * Es la decisión que hace que la previsualización valga algo. `InvoiceCalculator
 * Service` es el que produce los importes que se PERSISTEN al crear una factura:
 * la misma segregación de base gravable por componente AIU, la misma aritmética
 * truncada hoja por hoja que exige FAU14, las mismas divergencias. Una segunda
 * implementación —aunque naciera idéntica— derivaría con el primer cambio, y
 * entonces el editor mostraría una factura de muestra que no es la que se emite.
 * Un desglose que no coincide con lo emitido no es una previsualización: es una
 * confianza falsa sobre el IVA que se va a declarar.
 *
 * Por la misma razón las reglas AIU no se re-implementan: la gravabilidad por
 * línea sale de `CalculatedLine.omit_tax_total`, que es exactamente la bandera
 * que `InvoiceFlowService` adjunta antes de firmar, y las contradicciones salen
 * de `divergences[]`, que es lo que las compuertas `INVOICING_AIU_004`/`005`
 * convierten en rechazo.
 */
@Injectable()
export class ProfilePreviewService {
  private readonly logger = new Logger(ProfilePreviewService.name);

  constructor(
    private readonly profiles: ProfilesService,
    private readonly calculator: InvoiceCalculatorService,
  ) {}

  /**
   * Proyecta el XML de una factura de muestra bajo la configuración vigente del
   * perfil `profile_id`.
   *
   * El perfil se lee por `ProfilesService.findOne`, que ya aplica el ámbito del
   * tenant y responde 404 indistinguible para «no existe» y «es de otra tienda».
   * No se replica esa lectura acá: hacerlo abriría un segundo camino de acceso al
   * perfil con su propia posibilidad de olvidar el filtro.
   */
  async preview(
    profile_id: number,
    dto: PreviewProfileDto,
  ): Promise<ProfilePreviewResult> {
    const profile = await this.profiles.findOne(profile_id);
    const config = profile.current_config as InvoiceProfileConfig | null;

    if (!config) {
      // Un perfil sin versión comprometida no tiene configuración que proyectar.
      // Se responde con el código del historial —no con un 500— porque es
      // exactamente el mismo hecho: la versión que la fila apunta no existe.
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_VERSION_001,
        `El perfil «${profile.name}» no tiene una configuración comprometida (versión ` +
          `${profile.current_version}), así que no hay nada que previsualizar. Guarda el perfil ` +
          'una vez y vuelve a intentarlo.',
        { profile_id, current_version: profile.current_version },
      );
    }

    const is_aiu =
      profile.operation_type === DIAN_INVOICE_OPERATION_TYPES.AIU;

    const sample_lines = this.resolveSampleLines(dto, config, is_aiu);
    const contract_object =
      (dto.contract_object || '').trim() ||
      (config.aiu?.contract_object || '').trim();
    const note = is_aiu ? buildAiuNote(contract_object) : '';

    const calculation = this.calculator.calculate({
      items: sample_lines.map((line) => this.toCalculatorLine(line, config)),
      ...(is_aiu && config.aiu
        ? {
            aiu: {
              // Espeja InvoicingService.resolveAiuContext: `taxable_basis` si
              // el perfil ya lo trae, si no derivado de `regime` sin
              // reescribir el snapshot.
              taxable_basis: resolveAiuTaxableBasis(config.aiu),
              enforce_minimum_base: config.aiu.enforce_minimum_base,
              minimum_base_percent: config.aiu.minimum_base_percent,
            },
          }
        : {}),
    });

    const ubl_lines = this.toUblLines(
      calculation.lines,
      sample_lines,
      is_aiu ? note : '',
    );

    const issue_date = dto.issue_date || this.today();
    const xml = UblInvoiceBuilder.build({
      invoice_data: {
        invoice_number: PREVIEW_INVOICE_NUMBER,
        invoice_type: 'sales_invoice',
        issue_date,
        subtotal_amount: calculation.totals.total_before_tax,
        discount_amount: calculation.totals.discount_amount,
        tax_amount: calculation.totals.tax_amount,
        withholding_amount: '0.00',
        total_amount: calculation.totals.total_amount,
        items: ubl_lines,
        taxes: this.toHeaderTaxes(calculation),
        operation_type: profile.operation_type,
        payment_means: config.dian.payment_means_code ?? undefined,
        payment_form: config.dian.payment_method_code ?? undefined,
        notes: (config.dian.header_notes ?? []).join(' ') || undefined,
      },
      issuer: PREVIEW_ISSUER,
      customer: this.resolveCustomer(dto),
      software_security: PREVIEW_SOFTWARE_SECURITY,
      cufe: PREVIEW_CUFE,
      // SIEMPRE 'test'. `ProfileExecutionID` es el campo que declara ante la
      // DIAN si el documento es de producción; un XML de muestra que se
      // declarara productivo sería, en todo lo que se puede leer de él, un
      // documento de producción sin firmar.
      environment: 'test',
      control: PREVIEW_CONTROL,
      invoice_type_code: DIAN_DOCUMENT_TYPES.INVOICE,
    });

    // Se parsea UNA vez y el DOM viaja: los totales del desglose y las reglas
    // tienen que mirar el MISMO documento. Dos parseos independientes es una
    // puerta abierta a que el informe juzgue un XML y la pantalla muestre otro.
    const doc = this.parse(xml);

    const validations = this.evaluate({
      doc,
      xml,
      calculation,
      ubl_lines,
      sample_lines,
      config,
      profile_operation_type: profile.operation_type,
      is_aiu,
      note,
      contract_object,
    });

    return {
      profile: {
        id: profile.id,
        name: profile.name,
        operation_type: profile.operation_type,
        version: profile.current_version,
      },
      not_performed: {
        numbering_reserved: false,
        signed: false,
        transmitted: false,
        persisted: false,
      },
      xml,
      breakdown: {
        lines: this.toBreakdown(
          calculation.lines,
          sample_lines,
          is_aiu ? note : '',
        ),
        totals: this.readXmlTotals(doc),
      },
      aiu_summary: calculation.aiu
        ? {
            ...calculation.aiu,
            note: note || null,
            // Ventana de transición: las DOS claves. Ver el tipo.
            regime: regimeFromTaxableBasis(calculation.aiu.taxable_basis),
          }
        : null,
      validations,
    };
  }

  // ─── Composición de la muestra ──────────────────────────────────────────

  /**
   * Las líneas de la muestra, en el vocabulario de buckets.
   *
   * Modo explícito (`dto.lines`) y modo derivado (`dto.contract_value`) son
   * excluyentes: con los dos presentes quedaría ambiguo cuál manda sobre el
   * valor del contrato, y esa ambigüedad cambia la base gravable y el piso legal.
   * Con ninguno no hay nada que proyectar.
   */
  private resolveSampleLines(
    dto: PreviewProfileDto,
    config: InvoiceProfileConfig,
    is_aiu: boolean,
  ): SampleLine[] {
    const has_explicit = Array.isArray(dto.lines) && dto.lines.length > 0;
    const has_derived = dto.contract_value != null;

    if (has_explicit && has_derived) {
      throw this.unusableSample(
        'La muestra declara a la vez `lines` y `contract_value`, y los dos definen el valor del ' +
          'contrato. Manda uno solo: `lines` para construir la factura a mano, o `contract_value` ' +
          'para que el perfil la derive de sus líneas modelo.',
        { has_lines: true, has_contract_value: true },
      );
    }

    if (has_explicit) {
      return dto.lines!.map((line, index) => this.toSampleLine(line, index));
    }

    if (!has_derived) {
      throw this.unusableSample(
        'La muestra está vacía. Manda `contract_value` para derivar la factura de las líneas ' +
          'modelo del perfil, o `lines` con las líneas que quieras previsualizar.',
        { has_lines: false, has_contract_value: false },
      );
    }

    return this.derivePreviewLines(dto, config, is_aiu);
  }

  /** Traduce una línea del DTO al vocabulario interno. */
  private toSampleLine(
    line: PreviewProfileLineDto,
    index: number,
  ): SampleLine {
    const bucket = line.bucket as AiuBucket;
    return {
      index,
      bucket,
      description:
        (line.description || '').trim() || BUCKET_DEFAULT_DESCRIPTION[bucket],
      quantity: line.quantity ?? 1,
      unit_price: line.unit_price,
      discount_amount: line.discount_amount ?? 0,
      unit_code: (line.unit_code || '').trim() || PREVIEW_DEFAULT_UNIT_CODE,
    };
  }

  /**
   * Deriva la factura de muestra desde `contract_value` y el perfil.
   *
   * ## De dónde sale la porción AIU cuando nadie la declara
   *
   * Del **piso legal del propio perfil** (`aiu.minimum_base_percent`), no de un
   * porcentaje inventado. Tres consecuencias, todas buscadas:
   *
   * · Es la muestra más conservadora: cualquier AIU real será mayor o igual.
   * · Hace VISIBLE el piso, que es el parámetro que el operador está ajustando.
   * · La muestra queda exactamente EN el piso, así que si la validación del
   *   mínimo falla sobre ella, el defecto está en el perfil (un reparto de
   *   componentes que no suma 100, un régimen que no grava nada) y no en la
   *   muestra — que es justo lo que la previsualización tiene que delatar.
   *
   * Un perfil sin sección AIU (operación estándar) reparte todo el contrato en
   * una única línea de costo: no hay componentes que repartir.
   *
   * ## El reparto CUADRA AL CÉNTIMO, y por qué es la mitad de la promesa
   *
   * La tercera consecuencia de arriba —«si el mínimo falla, el defecto está en
   * el perfil y no en la muestra»— sólo es cierta si la muestra no pierde nada
   * al repartir. Truncando cada porción por separado sí perdía:
   *
   *     contrato 1.000.050,00 · AIU 10 % = 100.005,00 · reparto 33,33/33,33/33,34
   *     33.331,66 + 33.331,66 + 33.341,66 = 100.004,98   ← se fugan 0,02
   *     Σ líneas = 100.004,98 + 900.045,00 = 1.000.049,98 ← no es el contrato
   *     piso = 10 % × 1.000.049,98 = 100.004,998 → truncado 100.004,99
   *     100.004,98 < 100.004,99  ⇒  `aiu_base_below_minimum`
   *
   * Un perfil perfectamente legal se reportaba con `INVOICING_AIU_001` por dos
   * céntimos, y el mensaje culpaba al perfil de un defecto de la muestra —lo
   * contrario exacto de lo que este método promete—. Con una fuga de 0,01 el
   * truncado del piso lo salvaba, así que el caso intuitivo no lo delataba: es
   * una asimetría del truncado, no una casualidad.
   *
   * Hoy el reparto va por {@link splitAiuByComponents} (resto mayor) y la línea
   * de costo se obtiene POR RESTA del contrato, no truncando aparte. Los dos
   * invariantes que quedan cerrados por construcción:
   *
   * · Σ porciones A+I+U = el valor del AIU, al céntimo.
   * · Σ TODAS las líneas = el valor del contrato que escribió el operador.
   *
   * Y se cierran **sin** tapar el defecto que el docblock promete delatar: el
   * residuo que se reparte es el del truncamiento, medido contra el total que
   * el propio reparto representa. Un perfil cuyos porcentajes no sumen 100
   * sigue produciendo un AIU distinto del declarado —y por tanto sigue cayendo
   * por debajo del piso— porque esa diferencia no es un céntimo de redondeo.
   */
  private derivePreviewLines(
    dto: PreviewProfileDto,
    config: InvoiceProfileConfig,
    is_aiu: boolean,
  ): SampleLine[] {
    const contract_value = toDecimal(dto.contract_value ?? 0);

    if (!is_aiu || !config.aiu) {
      return [
        {
          index: 0,
          bucket: 'costo',
          description: this.modelDescription(config, 'costo'),
          quantity: 1,
          unit_price: Number(dianAmount(contract_value)),
          discount_amount: 0,
          unit_code: this.modelUnitCode(config, 'costo'),
        },
      ];
    }

    const aiu_value =
      dto.aiu_value != null
        ? toDecimal(dto.aiu_value)
        : contract_value
            .times(toDecimal(config.aiu.minimum_base_percent))
            .dividedBy(100);

    if (aiu_value.greaterThan(contract_value)) {
      throw this.unusableSample(
        `La porción AIU de la muestra (${dianAmount(aiu_value)}) es mayor que el valor del ` +
          `contrato (${dianAmount(contract_value)}). El AIU es una parte del contrato, no un ` +
          'recargo sobre él.',
        {
          contract_value: dianAmount(contract_value),
          aiu_value: dianAmount(aiu_value),
        },
      );
    }

    const portions = this.splitAiuByComponents(
      aiu_value,
      contract_value,
      config,
    );
    const lines: SampleLine[] = [];

    // Los tres componentes, en el orden del anexo: Administración primero,
    // porque es la línea que lleva la nota CAV03 y la que el operador busca.
    // El ORDEN DE EMISIÓN es ése; el orden en el que se reparte el céntimo
    // residual es otro y vive en `splitAiuByComponents`.
    AIU_EMISSION_ORDER.forEach((component) => {
      lines.push({
        index: lines.length,
        bucket: component,
        description: this.modelDescription(config, component),
        quantity: 1,
        unit_price: Number(dianAmount(portions.get(component) ?? toDecimal(0))),
        discount_amount: 0,
        unit_code: this.modelUnitCode(config, component),
      });
    });

    // El costo reembolsable se obtiene POR RESTA de lo ya emitido, no truncando
    // `contrato − AIU` aparte. Es lo que ata la segunda mitad del invariante:
    // Σ líneas es el valor del contrato TAL COMO SE EMITE, sin que un céntimo
    // se pierda entre el AIU y el costo. Truncados por separado, los dos lados
    // podían perder medio céntimo cada uno y la cabecera acababa declarando un
    // contrato que ninguna línea sostiene.
    const emitted_aiu = [...portions.values()].reduce(
      (acc, value) => acc.plus(value),
      toDecimal(0),
    );
    const cost_value = toDecimal(dianAmount(contract_value)).minus(emitted_aiu);

    // La línea de costo reembolsable sólo existe si sobra contrato. Emitir una
    // línea en cero declararía un concepto que no se factura, y el propio DTO
    // prohíbe cantidad cero por la misma razón.
    if (cost_value.greaterThan(0)) {
      lines.push({
        index: lines.length,
        bucket: 'costo',
        description: this.modelDescription(config, 'costo'),
        quantity: 1,
        unit_price: Number(dianAmount(cost_value)),
        discount_amount: 0,
        unit_code: this.modelUnitCode(config, 'costo'),
      });
    }

    return lines;
  }

  /**
   * Reparte el AIU entre sus tres componentes **por el método del resto mayor**,
   * de modo que la suma de las porciones sea EXACTAMENTE el total que el reparto
   * representa, y no ese total menos los céntimos que se fugaron al truncar.
   *
   * ## El algoritmo, y por qué es estable
   *
   * 1. Porción exacta de cada componente, en `Decimal` y a precisión plena.
   * 2. `objetivo` = la suma exacta, truncada a 2 decimales — lo que el reparto
   *    vale como importe emitible.
   * 3. Cada porción truncada a 2 decimales (truncar, nunca redondear: Anexo 1.9
   *    §11.2), guardando su parte fraccionaria.
   * 4. `residuo` = objetivo − Σ truncadas. Es ≥ 0 y menor que 3 céntimos, así
   *    que se reparte de uno en uno entre las porciones de mayor parte
   *    fraccionaria. Empate ⇒ {@link AIU_RESIDUE_PRIORITY}, que es un literal:
   *    dos ejecuciones con la misma entrada dan el mismo resultado, y nada
   *    depende del orden de iteración del JSON persistido.
   *
   * El residuo sólo puede ENTRAR al AIU, nunca salir, que es la dirección que
   * protege el piso legal: la base sube como máximo dos céntimos respecto del
   * truncado puro, y jamás baja.
   *
   * ## Sobre qué se reparte: `components_basis` decide la base, no un defecto
   *
   * `ProfileAiuConfig.components` mide sus tres porcentajes contra el AIU
   * (`'aiu'`, deben sumar 100 — `AIU_PERCENT_SUM`) o contra el CONTRATO
   * (`'contract'`, su suma ES el AIU: entre 0,01 % y 100 % —
   * `AIU_PERCENT_SUM_OF_CONTRACT`, ambas en `invoice-profile-config.contract.ts`).
   * Las dos unidades son legales y están validadas; `'contract'` no es un perfil
   * mal configurado — de hecho es el que siembra `buildDefaultAiuProfileConfig`
   * para todo perfil AIU nuevo (5/2/3, suma 10 = el piso legal). Una versión
   * anterior de este método ignoraba `components_basis` y repartía siempre
   * sobre `aiu_value`, así que bajo `'contract'` una suma de 10 se leía como
   * "10 % de `aiu_value`" en vez de "10 % del contrato": el AIU emitido salía
   * diez veces menor que el real, `checkAiuDivergences` lo comparaba contra el
   * piso legal y CUALQUIER perfil recién creado, sin tocar un campo, se
   * reportaba con `INVOICING_AIU_001` estando exactamente EN el piso. Por eso
   * el reparto se hace sobre `contract_value` cuando `resolveAiuComponentsBasis`
   * resuelve `'contract'`, y sobre `aiu_value` cuando resuelve `'aiu'` (su valor
   * también para ausencia o dato corrupto — la unidad heredada, conservadora).
   *
   * ## Qué SÍ sigue sin hacer: no fuerza el total al AIU declarado
   *
   * El objetivo del paso 2 es la suma de las porciones sobre la base que le
   * toca, no `aiu_value` a la fuerza. Bajo `'aiu'` con porcentajes que no sumen
   * 100 —eso sí es un perfil mal configurado— la suma diverge de `aiu_value` y
   * la diferencia se queda fuera a propósito: es el defecto que la
   * previsualización existe para delatar (ver el docblock de
   * {@link derivePreviewLines}). Forzarla a `aiu_value` lo taparía.
   */
  private splitAiuByComponents(
    aiu_value: ReturnType<typeof toDecimal>,
    contract_value: ReturnType<typeof toDecimal>,
    config: InvoiceProfileConfig,
  ): Map<AiuComponentLiteral, ReturnType<typeof toDecimal>> {
    const basis = resolveAiuComponentsBasis(config.aiu);
    const base = basis === 'contract' ? contract_value : aiu_value;
    const parts = AIU_EMISSION_ORDER.map((component) => {
      const share = toDecimal(config.aiu?.components?.[component]);
      const exact = base.times(share).dividedBy(100);
      const truncated = toDecimal(dianAmount(exact));
      return {
        component,
        exact,
        amount: truncated,
        remainder: exact.minus(truncated),
      };
    });

    const target = toDecimal(
      dianAmount(
        parts.reduce((acc, part) => acc.plus(part.exact), toDecimal(0)),
      ),
    );
    let residue = parts.reduce(
      (acc, part) => acc.minus(part.amount),
      target,
    );

    // Resto mayor primero; a igualdad de resto, la prioridad fiscal. Las dos
    // claves son totales sobre tres elementos, así que el orden es único y no
    // se apoya en la estabilidad de `sort`.
    const by_largest_remainder = [...parts].sort((a, b) => {
      const by_remainder = b.remainder.comparedTo(a.remainder);
      if (by_remainder !== 0) return by_remainder;
      return (
        AIU_RESIDUE_PRIORITY.indexOf(a.component) -
        AIU_RESIDUE_PRIORITY.indexOf(b.component)
      );
    });

    for (const part of by_largest_remainder) {
      if (residue.lessThan(ONE_CENT)) break;
      part.amount = part.amount.plus(ONE_CENT);
      residue = residue.minus(ONE_CENT);
    }

    return new Map(parts.map((part) => [part.component, part.amount]));
  }

  private modelDescription(
    config: InvoiceProfileConfig,
    bucket: AiuBucket,
  ): string {
    const model = config.model_lines.find((line) => line.bucket === bucket);
    return (model?.description || '').trim() || BUCKET_DEFAULT_DESCRIPTION[bucket];
  }

  private modelUnitCode(
    config: InvoiceProfileConfig,
    bucket: AiuBucket,
  ): string {
    const model = config.model_lines.find((line) => line.bucket === bucket);
    return (model?.unit_code || '').trim() || PREVIEW_DEFAULT_UNIT_CODE;
  }

  // ─── Puente hacia el calculador y hacia el constructor UBL ──────────────

  /**
   * Convierte una línea de muestra en entrada del calculador, **aplicando la
   * matriz de tarifas del perfil**.
   *
   * Es el aporte del perfil, y la razón de ser de la feature: el calculador sabe
   * qué componentes gravan —lo deriva del régimen— pero no a qué tarifa, porque
   * la tarifa depende del bien o servicio y no hay catálogo del que deducirla.
   * La regla del bucket es esa tarifa.
   *
   * Una regla con `taxable: false` no produce impuesto. Una con `taxable: true` y
   * `rate: '0.00'` SÍ produce un impuesto de tarifa cero, y la diferencia es
   * exactamente la que el anexo distingue: un servicio EXENTO declara su grupo
   * `cac:TaxTotal` con `cbc:Percent` en 0,00, mientras que una porción excluida no
   * declara grupo alguno. Colapsarlas produciría un rechazo FAX01 o una
   * sub-declaración, según el lado en que se colapse.
   */
  private toCalculatorLine(
    line: SampleLine,
    config: InvoiceProfileConfig,
  ): InvoiceCalculatorLineInput {
    const rule = this.ruleFor(config.taxes.rules, line.bucket);
    const aiu_component: AiuComponent | null =
      line.bucket === 'costo' ? null : line.bucket;

    return {
      description: line.description,
      aiu_component,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount_amount: line.discount_amount,
      ...(rule && rule.taxable
        ? {
            taxes: [
              {
                tax_name: DIAN_TAX_NAMES[rule.tax_code] || rule.tax_code,
                tax_rate: rule.rate,
                tax_type: TAX_TYPE_BY_DIAN_CODE[rule.tax_code],
              },
            ],
          }
        : {}),
    };
  }

  private ruleFor(
    rules: readonly ProfileTaxRule[],
    bucket: AiuBucket,
  ): ProfileTaxRule | undefined {
    return rules.find((rule) => rule.bucket === bucket);
  }

  /**
   * `CalculatedLine[]` → `UblDocumentLine[]`.
   *
   * `omit_tax_total` viaja TAL CUAL desde el calculador. No se recalcula acá: es
   * la bandera que decide si la línea emite `cac:TaxTotal`, y derivarla otra vez
   * en este punto sería la segunda implementación de la gravabilidad AIU que este
   * servicio existe para no tener.
   *
   * `quantity`, `unit_price` y `discount_amount` se pasan CRUDOS —los mismos que
   * recibió el calculador— porque el constructor UBL recalcula
   * `cbc:LineExtensionAmount` con `dianLineExtension` sobre ellos. Pasarle los
   * importes ya calculados haría que el XML declarara una base distinta de la que
   * el desglose reporta.
   */
  private toUblLines(
    lines: CalculatedLine[],
    sample: SampleLine[],
    note: string,
  ): UblDocumentLine[] {
    return lines.map((line, index) => {
      const source = sample[index];
      const is_administracion = source?.bucket === 'administracion';

      return {
        description: line.description || source?.description || '',
        quantity: String(source?.quantity ?? 1),
        unit_price: String(source?.unit_price ?? 0),
        discount_amount: String(source?.discount_amount ?? 0),
        tax_amount: line.tax_amount,
        total_amount: line.total_amount,
        unit_code: source?.unit_code || PREVIEW_DEFAULT_UNIT_CODE,
        item_code: String(index + 1),
        taxes: line.taxes.map((tax) => this.toProviderTax(tax)),
        omit_tax_total: line.omit_tax_total,
        ...(note && is_administracion ? { note } : {}),
      };
    });
  }

  private toProviderTax(tax: {
    tax_name: string;
    tax_type: string;
    tax_rate: string;
    taxable_amount: string;
    tax_amount: string;
  }): ProviderInvoiceTax {
    return {
      tax_name: tax.tax_name,
      tax_rate: tax.tax_rate,
      taxable_amount: tax.taxable_amount,
      tax_amount: tax.tax_amount,
      tax_type: tax.tax_type,
    };
  }

  private toHeaderTaxes(
    calculation: InvoiceCalculatorResult,
  ): ProviderInvoiceTax[] {
    return calculation.header_taxes.map((tax) => this.toProviderTax(tax));
  }

  /**
   * El desglose que lee el editor.
   *
   * La `note` se reporta en la MISMA línea donde el XML la escribe —la de
   * Administración— y no como un campo de cabecera. Es lo que permite que la
   * columna de la tabla y el `cbc:Note` del XML se puedan comparar de un vistazo:
   * si el desglose dijera «hay nota» sin decir dónde, la regla CAV03 (que exige
   * que esté EN esa línea) no sería verificable desde la pantalla.
   */
  private toBreakdown(
    lines: CalculatedLine[],
    sample: SampleLine[],
    note: string,
  ): ProfilePreviewLine[] {
    return lines.map((line, index) => {
      const source = sample[index];
      return {
        index,
        bucket: source?.bucket ?? 'costo',
        description: line.description || source?.description || '',
        unit_code: source?.unit_code || PREVIEW_DEFAULT_UNIT_CODE,
        quantity: String(source?.quantity ?? 1),
        unit_price: dianAmount(source?.unit_price ?? 0),
        discount_amount: dianAmount(source?.discount_amount ?? 0),
        line_extension_amount: line.line_extension_amount,
        tax_amount: line.tax_amount,
        total_amount: line.total_amount,
        taxes: line.taxes.map((tax) => ({
          dian_tax_code: tax.dian_tax_code,
          tax_name: tax.tax_name,
          tax_rate: tax.tax_rate,
          taxable_amount: tax.taxable_amount,
          tax_amount: tax.tax_amount,
        })),
        omit_tax_total: line.omit_tax_total,
        note: note && source?.bucket === 'administracion' ? note : null,
      };
    });
  }

  /**
   * Los totales del desglose, **leídos del XML** y no del cálculo.
   *
   * ## Por qué no se copian del calculador
   *
   * Porque no son los mismos números, y descubrirlo costó una vuelta. El
   * calculador expone `totals.total_before_tax` —el valor del contrato— y la
   * primera versión lo publicaba también como `tax_exclusive_amount`. En un
   * contrato AIU de 100 M con 10 M de AIU, el XML declara `TaxExclusiveAmount` =
   * **10 M** (la base gravable) y la pantalla mostraba **100 M**.
   *
   * Es el defecto exacto que esta feature existe para no tener: un desglose que
   * no coincide con lo que se emite le da al operador confianza falsa sobre la
   * cifra que determina cuánto IVA declara. Y no se arregla copiando el otro
   * campo del calculador —se arregla dejando de tener dos fuentes—. Leyendo el
   * documento, la pantalla y el XML son la misma cosa por construcción: si el
   * builder cambia mañana, la pantalla cambia con él.
   *
   * `discount_amount` sale de `cbc:AllowanceTotalAmount`, que es el descuento a
   * nivel de DOCUMENTO. Los descuentos de línea ya están descontados dentro de
   * cada `cbc:LineExtensionAmount`, así que sumar los dos contaría dos veces.
   */
  private readXmlTotals(doc: any): ProfilePreviewResult['breakdown']['totals'] {
    const totals =
      this.firstElement(doc, 'LegalMonetaryTotal') ??
      this.firstElement(doc, 'RequestedMonetaryTotal');

    const header_tax = this.elements(doc, 'TaxTotal')
      .filter((node) => !this.isInsideInvoiceLine(node))
      .reduce(
        (acc, node) => acc.plus(toDecimal(this.textOf(node, 'TaxAmount'))),
        toDecimal(0),
      );

    const read = (name: string) => dianAmount(toDecimal(this.textOf(totals, name)));

    return {
      line_extension_amount: read('LineExtensionAmount'),
      discount_amount: read('AllowanceTotalAmount'),
      tax_exclusive_amount: read('TaxExclusiveAmount'),
      tax_amount: dianAmount(header_tax),
      tax_inclusive_amount: read('TaxInclusiveAmount'),
      payable_amount: read('PayableAmount'),
    };
  }

  private resolveCustomer(dto: PreviewProfileDto): DianCustomerData {
    if (!dto.customer) return PREVIEW_CUSTOMER;
    return {
      ...PREVIEW_CUSTOMER,
      document_type:
        (dto.customer.document_type || '').trim() ||
        PREVIEW_CUSTOMER.document_type,
      document_number:
        (dto.customer.document_number || '').trim() ||
        PREVIEW_CUSTOMER.document_number,
      legal_name:
        (dto.customer.legal_name || '').trim() || PREVIEW_CUSTOMER.legal_name,
    };
  }

  /** Fecha de hoy en `YYYY-MM-DD`. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private unusableSample(
    message: string,
    details: Record<string, unknown>,
  ): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.INVOICING_PREVIEW_002,
      message,
      details,
    );
  }

  // ─── Evaluación de las reglas del anexo ─────────────────────────────────

  /**
   * Las reglas del Anexo Técnico y los invariantes internos, evaluados sobre el
   * XML **ya construido**.
   *
   * ## Por qué se leen del XML y no del cálculo
   *
   * Porque el XML es lo que la DIAN recibe. Una aserción sobre el resultado del
   * calculador comprueba que el calculador es coherente consigo mismo, que ya lo
   * garantizan sus propios tests; lo que ninguna de las dos mitades puede ver
   * sola es que el constructor UBL escriba en el documento lo que el cálculo
   * decidió. FAU04 y FAX01 son exactamente ese descuadre, y ése es el rechazo que
   * quema consecutivos.
   *
   * Las reglas que NO son observables en el XML —el piso legal, la
   * contradicción entre gravabilidad e importes— se leen de `divergences[]`, que
   * es la misma fuente que las compuertas de emisión convierten en rechazo.
   */
  private evaluate(input: {
    doc: any;
    xml: string;
    calculation: InvoiceCalculatorResult;
    ubl_lines: UblDocumentLine[];
    sample_lines: SampleLine[];
    config: InvoiceProfileConfig;
    profile_operation_type: string;
    is_aiu: boolean;
    note: string;
    contract_object: string;
  }): ProfilePreviewValidation[] {
    const validations: ProfilePreviewValidation[] = [];
    const doc = input.doc;

    validations.push(this.checkStructure(input.xml));
    validations.push(this.checkCustomizationId(doc, input.profile_operation_type));
    validations.push(...this.checkDianTotals(input.xml));
    validations.push(...this.checkMonetaryTotals(doc));
    validations.push(this.checkFax01(doc, input.ubl_lines));
    validations.push(...this.checkTaxCatalogues(input));
    validations.push(...this.checkUnitCodes(input.sample_lines));
    validations.push(
      ...this.checkNoTaxDeclared(input.calculation, input.config),
    );

    if (input.is_aiu) {
      validations.push(this.checkAiuNote(doc, input.note, input.contract_object));
      validations.push(...this.checkAiuDivergences(input.calculation));
    }

    return validations;
  }

  private parse(xml: string): any {
    // El validador de estructura ya reporta un XML mal formado como violación;
    // acá el parseo silencioso basta, y las reglas que dependen del DOM devuelven
    // `passed: false` si el documento no se pudo leer.
    const parser = new DOMParser({ errorHandler: () => undefined });
    try {
      return parser.parseFromString(xml, 'text/xml');
    } catch {
      return null;
    }
  }

  private checkStructure(xml: string): ProfilePreviewValidation {
    const result = UblStructureValidator.validate(xml);
    return {
      rule: 'UBL-STRUCTURE',
      passed: result.valid && result.root !== null,
      severity: 'blocker',
      code: null,
      message:
        result.valid && result.root !== null
          ? `La estructura del XML respeta el modelo de contenido de los XSD de la DIAN (raíz ${result.root}).`
          : 'La estructura del XML no respeta el modelo de contenido de los XSD de la DIAN. La DIAN lo rechazaría por esquema.',
      details: {
        root: result.root,
        violations: result.violations.map((v: UblStructureViolation) => ({
          path: v.path,
          kind: v.kind,
          message: v.message,
        })),
      },
    };
  }

  /**
   * FAS01b y las cuatro identidades de totales — **la compuerta real**, no una
   * imitación.
   *
   * `DianTotalsValidator` es el validador que corre en `signXml` justo antes de
   * firmar, en el camino de emisión de verdad. Llamarlo desde acá es el punto
   * entero de esta previsualización: lo que dictamine sobre el XML de muestra es,
   * palabra por palabra, lo que dictaminará sobre el documento real.
   *
   * La primera versión de este servicio re-implementaba las dos reglas a mano y
   * las dos salieron peor:
   *
   * · **FAU04.** La versión propia comparaba `cbc:TaxExclusiveAmount` con las
   *   bases de los `cac:TaxTotal` de CABECERA. La regla del anexo compara contra
   *   las de **LÍNEA**
   *   (`//cac:InvoiceLine/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount`), que es
   *   una cifra distinta en cuanto una línea omite su grupo — exactamente el caso
   *   AIU. Habría aprobado documentos que la DIAN rechaza.
   * · **FAS01b.** Ni existía. Un documento sin impuestos que igual publica el nodo
   *   `cac:TaxTotal` es rechazo, y ninguna regla propia lo miraba.
   *
   * El código que se reporta es `INVOICING_XSD_002`, el mismo que la compuerta
   * real lanza. Así el aviso de la previsualización y el error de la emisión son
   * literalmente el mismo hecho con el mismo identificador, y no dos opiniones.
   */
  private checkDianTotals(xml: string): ProfilePreviewValidation[] {
    const result = DianTotalsValidator.validate(xml);

    if (result.root === null) {
      // `root: null` significa «este documento no lleva totales que juzgar», no
      // «pasó». Se reporta como informativo para que la ausencia de la regla sea
      // visible: un informe donde FAU04 simplemente no aparece se lee como si la
      // regla se hubiera cumplido.
      return [
        {
          rule: 'FAS01b + AU02/AU04/AU06/AU14',
          passed: true,
          severity: 'info',
          code: null,
          message:
            'El documento no lleva totales monetarios que estas reglas puedan juzgar, así que no aplicaron.',
          details: { root: null },
        },
      ];
    }

    const by_rule = new Map<string, DianTotalsViolation[]>();
    result.violations.forEach((violation) => {
      const bucket = by_rule.get(violation.rule) ?? [];
      bucket.push(violation);
      by_rule.set(violation.rule, bucket);
    });

    if (result.valid) {
      return [
        {
          rule: 'FAS01b + AU02/AU04/AU06/AU14',
          passed: true,
          severity: 'blocker',
          code: null,
          message:
            'Las cuatro identidades de totales cierran: el bruto de cabecera es ' +
            'la suma de las líneas, la base imponible es la que declaran las ' +
            'líneas, el bruto más tributos es el bruto más los tributos de ' +
            'cabecera, y el valor a pagar sale de esa cifra menos el descuento ' +
            'más el cargo. Y ninguna totalización aparece sobre un documento sin ' +
            'impuestos.',
          details: { root: result.root },
        },
      ];
    }

    return [...by_rule.entries()].map(([rule, violations]) => ({
      rule,
      passed: false,
      severity: 'blocker' as PreviewValidationSeverity,
      code: ErrorCodes.INVOICING_XSD_002.code,
      message:
        `${violations.length} violación(es) de la regla ${rule} del Anexo Técnico. ` +
        'La emisión real se aborta ANTES de firmar, así que el consecutivo no se gasta — pero el ' +
        `documento no se puede emitir tal como está. ${violations[0].message}`,
      details: {
        root: result.root,
        violations: violations.map((violation) => ({
          kind: violation.kind,
          path: violation.path,
          message: violation.message,
          ...(violation.details ? { details: violation.details } : {}),
        })),
      },
    }));
  }

  /**
   * `cbc:CustomizationID` = el tipo de operación del perfil.
   *
   * Se compara contra `DIAN_INVOICE_OPERATION_TYPES`, nunca contra un literal.
   * El defecto que esta regla vigila es real y ya ocurrió: el builder tenía `'10'`
   * cableado, así que un contrato AIU salía declarado como operación estándar y la
   * DIAN no aplicaba las reglas CAV/CAX — el documento entraba con una base
   * gravable que nadie validaba.
   */
  private checkCustomizationId(
    doc: any,
    operation_type: string,
  ): ProfilePreviewValidation {
    const declared = this.textOf(doc, 'CustomizationID');
    const expected =
      operation_type === DIAN_INVOICE_OPERATION_TYPES.AIU
        ? DIAN_INVOICE_OPERATION_TYPES.AIU
        : operation_type;

    return {
      rule: 'CustomizationID',
      passed: declared === expected,
      severity: 'blocker',
      code: null,
      message:
        declared === expected
          ? `El documento declara la operación ${declared}, que es la del perfil.`
          : `El documento declara la operación «${declared}» y el perfil es de tipo «${expected}». ` +
            'Una operación mal declarada hace que la DIAN aplique un juego de reglas distinto del ' +
            'que corresponde al documento.',
      details: { declared, expected },
    };
  }

  /**
   * DESGLOSE de los totales de cabecera. **No dictamina: describe.**
   *
   * ## Por qué dejó de dictaminar
   *
   * Esta función comprobaba a mano tres identidades, y las tres estaban mal de
   * una forma que sólo se ve al lado del anexo:
   *
   * · Llamaba **`FAU14`** a «cabecera = Σ líneas». Esa identidad es **FAU02**;
   *   FAU14 es el valor a pagar. Un operador que recibiera el rechazo real
   *   buscaría la regla equivocada en esta pantalla.
   * · Llamaba **`TOTALES-COHERENCIA`** —un identificador inventado, que la DIAN
   *   nunca devuelve— a lo que son **FAU06** y **FAU14**.
   * · Comparaba con `.equals()`, es decir a la última cifra decimal, cuando las
   *   reglas comparan con `round()` a peso entero. Un truncado hoja por hoja de
   *   40 centavos —normal en un documento con varias líneas— producía un
   *   BLOQUEO FALSO sobre un documento que la DIAN acepta.
   * · Exigía `PayableAmount == TaxInclusiveAmount`, que sólo vale sin descuento
   *   global. FAU14 es `TaxInclusive − AllowanceTotal + ChargeTotal`, así que
   *   todo perfil con descuento de documento se reportaba como defectuoso.
   *
   * Este archivo ya advierte, sobre otra regla, que «un falso bloqueo en esta
   * pantalla enseña al operador a ignorar los avisos, que es peor que no
   * tenerlos». Era el caso.
   *
   * ## Quién dictamina ahora
   *
   * `checkDianTotals`, que corre `DianTotalsValidator` —la MISMA compuerta de
   * `signXml`— y cubre las cuatro identidades (`AU02`, `AU04`, `AU06`, `AU14`)
   * más `FAS01b`, con los identificadores resueltos del catálogo del anexo y con
   * la semántica de `round()`. Un predicado, una implementación: dos copias de la
   * misma regla divergen, y la divergencia es invisible al spec que prueba una
   * sola de las dos.
   *
   * ## Qué aporta entonces este desglose
   *
   * Las cifras, que el veredicto no muestra. En un documento AIU los totales de
   * cabecera valen COSAS DISTINTAS y ésa es justo la parte que un régimen de base
   * segregada rompe:
   *
   * · `cbc:LineExtensionAmount` = **el valor del contrato** = Σ de las líneas.
   * · `cbc:TaxExclusiveAmount` = **la base gravable** = Σ de los
   *   `cac:TaxSubtotal/cbc:TaxableAmount`. En AIU es sólo la porción que grava —
   *   los 10 M de un contrato de 100 M—, NO la suma de las líneas.
   * · `cbc:TaxInclusiveAmount` = `LineExtensionAmount + tributos de CABECERA`. Se
   *   apoya en el valor del contrato, no en la base gravable: sumarle el impuesto
   *   a la base daría 11,9 M donde el cliente debe 101,9 M.
   *
   * Se deja escrito porque el error es atractivo —el nombre del campo dice «total
   * sin impuestos»— y porque ver las cinco cifras juntas es lo que permite
   * entender un rechazo en vez de sólo leerlo.
   */
  private checkMonetaryTotals(doc: any): ProfilePreviewValidation[] {
    const lines = this.elements(doc, 'InvoiceLine');
    const totals = this.firstElement(doc, 'LegalMonetaryTotal');
    const header_taxes = this.elements(doc, 'TaxTotal').filter(
      (node) => !this.isInsideInvoiceLine(node),
    );

    const declared_line_extension = toDecimal(
      this.textOf(totals, 'LineExtensionAmount'),
    );
    const sum_of_lines = lines.reduce(
      (acc, line) =>
        acc.plus(toDecimal(this.textOf(line, 'LineExtensionAmount'))),
      toDecimal(0),
    );
    const header_tax_amount = header_taxes.reduce(
      (acc, tax_total) =>
        acc.plus(toDecimal(this.textOf(tax_total, 'TaxAmount'))),
      toDecimal(0),
    );

    const declared_tax_exclusive = toDecimal(
      this.textOf(totals, 'TaxExclusiveAmount'),
    );
    const declared_tax_inclusive = toDecimal(
      this.textOf(totals, 'TaxInclusiveAmount'),
    );
    const declared_allowance = toDecimal(
      this.textOf(totals, 'AllowanceTotalAmount'),
    );
    const declared_charge = toDecimal(this.textOf(totals, 'ChargeTotalAmount'));
    const declared_payable = toDecimal(this.textOf(totals, 'PayableAmount'));

    return [
      {
        rule: 'Totales del documento',
        passed: true,
        severity: 'info',
        code: null,
        message:
          `Valor del contrato ${dianAmount(declared_line_extension)} ` +
          `(Σ de ${lines.length} línea(s): ${dianAmount(sum_of_lines)}) · ` +
          `base gravable ${dianAmount(declared_tax_exclusive)} · ` +
          `tributos de cabecera ${dianAmount(header_tax_amount)} · ` +
          `bruto más tributos ${dianAmount(declared_tax_inclusive)} · ` +
          `a pagar ${dianAmount(declared_payable)}. ` +
          'Que el valor del contrato y la base gravable difieran es el régimen ' +
          'AIU funcionando, no un descuadre. El veredicto sobre estas cifras lo ' +
          'da la compuerta real (AU02, AU04, AU06, AU14), más arriba en este ' +
          'mismo informe.',
        details: {
          line_extension_amount: dianAmount(declared_line_extension),
          sum_of_lines: dianAmount(sum_of_lines),
          line_count: lines.length,
          tax_exclusive_amount: dianAmount(declared_tax_exclusive),
          header_tax_amount: dianAmount(header_tax_amount),
          tax_inclusive_amount: dianAmount(declared_tax_inclusive),
          allowance_total_amount: dianAmount(declared_allowance),
          charge_total_amount: dianAmount(declared_charge),
          payable_amount: dianAmount(declared_payable),
        },
      },
    ];
  }

  /**
   * FAX01 / CAX01 — ninguna línea excluida de la base declara su grupo de
   * impuestos, y ninguna emite `cbc:Percent` heredado de la cabecera.
   *
   * Se comprueba en las dos direcciones, y la condición NO es «tiene impuestos».
   * La primera versión exigía grupo a toda línea que no estuviera marcada para
   * omitirlo, y eso marcaba como defecto una factura correcta: un bien EXCLUIDO
   * (art. 476 E.T.) en un documento estándar no está sujeto al impuesto, así que
   * no declara grupo y su `omit_tax_total` es `false` porque esa bandera sólo la
   * pone el régimen AIU. Un bloqueo falso sobre un documento válido enseña al
   * operador a ignorar los avisos, que es peor que no tenerlos.
   *
   * La condición correcta es la que se lee: si la línea TRAE tributos, tiene que
   * publicarlos; si está marcada para omitir, no puede publicar nada. El caso
   * «sin tributos y sin marca» es legítimo y pasa.
   *
   * (Lo que ninguna de las dos ramas puede ver es si el documento entero se quedó
   * sin impuesto por una matriz mal configurada. Eso lo reporta
   * `checkNoTaxDeclared`.)
   */
  private checkFax01(
    doc: any,
    ubl_lines: UblDocumentLine[],
  ): ProfilePreviewValidation {
    const lines = this.elements(doc, 'InvoiceLine');
    const offenders: Array<Record<string, unknown>> = [];

    lines.forEach((line, index) => {
      const has_tax_total = this.elements(line, 'TaxTotal').length > 0;
      const has_percent = this.elements(line, 'Percent').length > 0;
      const should_omit = ubl_lines[index]?.omit_tax_total === true;
      const declares_taxes = (ubl_lines[index]?.taxes ?? []).length > 0;

      // CAX01 — la línea está FUERA de la base gravable y aun así publica su
      // grupo. Es rechazo por esquema, y con `cbc:Percent` presente es peor: el
      // builder emite el porcentaje del primer tributo de la cabecera, así que la
      // línea declara una tarifa que nadie escribió.
      if (should_omit && (has_tax_total || has_percent)) {
        offenders.push({
          line_index: index,
          description: ubl_lines[index]?.description,
          reason: 'omit_tax_total_but_emitted',
        });
      }

      // La simétrica: la línea SÍ trae impuestos y el documento no los publica.
      // El importe se perdería del XML mientras sigue sumado en el total de
      // cabecera — el descuadre FAU04 visto desde el otro lado.
      if (declares_taxes && !has_tax_total) {
        offenders.push({
          line_index: index,
          description: ubl_lines[index]?.description,
          reason: 'taxes_declared_but_not_emitted',
        });
      }
    });

    return {
      rule: 'FAX01',
      passed: offenders.length === 0,
      severity: 'blocker',
      code: null,
      message:
        offenders.length === 0
          ? 'Cada línea emite su grupo de impuestos si y sólo si hace parte de la base gravable.'
          : `${offenders.length} línea(s) declaran su grupo de impuestos de forma incoherente con la ` +
            'base gravable del régimen. Es motivo de rechazo por esquema o de descuadre aritmético.',
      details: { offenders },
    };
  }

  /**
   * Los códigos de tributo emitidos pertenecen a la tabla 13.2.2 **y son los que
   * el perfil declaró**.
   *
   * La segunda mitad es la que importa y no es obvia:
   * `UblCommonBuilder.resolveTaxCodeFromTax` deriva el código desde `tax_type`, y
   * su rama por omisión devuelve IVA. O sea que un perfil que declare un tributo
   * fuera de {IVA, INC, ICA} —la matriz los acepta, porque la tabla de la DIAN
   * tiene dieciséis— produciría un XML que declara IVA. Sin esta comprobación eso
   * es una mentira silenciosa sobre el impuesto que se recauda; con ella, el
   * operador lo ve antes de emitir.
   */
  private checkTaxCatalogues(input: {
    calculation: InvoiceCalculatorResult;
    sample_lines: SampleLine[];
    config: InvoiceProfileConfig;
  }): ProfilePreviewValidation[] {
    const unknown_codes: string[] = [];
    const mismatches: Array<Record<string, unknown>> = [];

    input.calculation.lines.forEach((line, index) => {
      const bucket = input.sample_lines[index]?.bucket;
      const rule = bucket
        ? this.ruleFor(input.config.taxes.rules, bucket)
        : undefined;

      line.taxes.forEach((tax) => {
        if (!isDianTaxSchemeCode(tax.dian_tax_code)) {
          unknown_codes.push(tax.dian_tax_code);
        }
        if (rule && rule.taxable && tax.dian_tax_code !== rule.tax_code) {
          mismatches.push({
            line_index: index,
            bucket,
            declared_in_profile: rule.tax_code,
            emitted_in_xml: tax.dian_tax_code,
          });
        }
      });
    });

    return [
      {
        rule: 'TABLA-13.2.2',
        passed: unknown_codes.length === 0,
        severity: 'blocker',
        code: null,
        message:
          unknown_codes.length === 0
            ? 'Todos los códigos de tributo emitidos pertenecen a la tabla de tributos de la DIAN.'
            : `Códigos de tributo fuera de la tabla 13.2.2: ${unknown_codes.join(', ')}.`,
        details: { unknown_codes },
      },
      {
        rule: 'TRIBUTO-FIDELIDAD',
        passed: mismatches.length === 0,
        severity: 'blocker',
        code: null,
        message:
          mismatches.length === 0
            ? 'El tributo que declara la matriz del perfil es el que sale en el XML.'
            : 'El XML declara un tributo distinto del que la matriz del perfil configuró. El emisor ' +
              'UBL sólo sabe emitir IVA, INC e ICA: cualquier otro código de la tabla se emite como ' +
              'IVA, así que el documento declararía un impuesto que no es el que se cobra.',
        details: { mismatches },
      },
    ];
  }

  /**
   * El documento no declara ningún impuesto.
   *
   * No es ilegal —una factura 100 % excluida existe— pero en el contexto de esta
   * pantalla es casi siempre una matriz de tarifas mal configurada: todos los
   * buckets con `taxable: false`, o el bucket que la muestra usa sin regla. El
   * daño es silencioso y de un solo lado: el documento se emite, la DIAN lo
   * acepta, y el IVA que se dejó de cobrar sólo aparece en una fiscalización,
   * cuando ya sólo se corrige con nota crédito.
   *
   * Es `warning` y no `blocker` por eso mismo: no se puede bloquear un caso
   * legítimo, pero tampoco se puede callar.
   */
  private checkNoTaxDeclared(
    calculation: InvoiceCalculatorResult,
    config: InvoiceProfileConfig,
  ): ProfilePreviewValidation[] {
    const declares_tax = calculation.lines.some((line) => line.taxes.length > 0);
    if (declares_tax) return [];

    const taxable_rules = config.taxes.rules.filter((rule) => rule.taxable);

    return [
      {
        rule: 'SIN-IMPUESTO',
        passed: false,
        severity: 'warning',
        code: null,
        message:
          'El documento no declara ningún impuesto. Puede ser correcto (una factura 100 % excluida ' +
          'lo es), pero revisa la matriz de tarifas del perfil: ' +
          (taxable_rules.length === 0
            ? 'ninguna de sus reglas marca la porción como gravable.'
            : `sus reglas gravables (${taxable_rules
                .map((rule) => rule.bucket)
                .join(', ')}) no aplican a ninguna línea de esta muestra.`),
        details: {
          taxable_buckets: taxable_rules.map((rule) => rule.bucket),
          buckets_in_sample: [
            ...new Set(calculation.lines.map((_, index) => index)),
          ].length,
        },
      },
    ];
  }

  /** Las unidades de la muestra pertenecen al catálogo UN/ECE rec. 20. */
  private checkUnitCodes(sample: SampleLine[]): ProfilePreviewValidation[] {
    const unknown = sample
      .map((line) => line.unit_code)
      .filter((code) => !KNOWN_UNIT_CODES.has(code));

    return [
      {
        rule: 'UNIDADES-UNECE',
        passed: unknown.length === 0,
        severity: 'warning',
        code: null,
        message:
          unknown.length === 0
            ? 'Todas las unidades pertenecen al catálogo UN/ECE que la DIAN acepta.'
            : `Unidades desconocidas: ${[...new Set(unknown)].join(', ')}. La DIAN valida la ` +
              'coherencia entre cantidad y unidad.',
        details: { unknown_unit_codes: [...new Set(unknown)] },
      },
    ];
  }

  /**
   * CAV03 / FAV03 — la nota del objeto del contrato.
   *
   * Tres cosas, y las tres son motivo de rechazo por separado: que la nota EXISTA
   * en la línea de Administración, que empiece por el literal EXACTO del anexo, y
   * que su longitud completa —prefijo incluido— quepa en `20..5000`. Se comprueba
   * sobre el XML, en la línea donde el anexo la exige, y no sobre la cadena que
   * se compuso: es el único modo de detectar que la nota se adjuntó a la línea
   * equivocada.
   */
  private checkAiuNote(
    doc: any,
    note: string,
    contract_object: string,
  ): ProfilePreviewValidation {
    const lines = this.elements(doc, 'InvoiceLine');
    const notes_by_line = lines.map((line) => this.textOf(line, 'Note'));
    const with_note = notes_by_line
      .map((text, index) => ({ text, index }))
      .filter((entry) => !!entry.text);

    const problems: string[] = [];

    if (!contract_object) {
      problems.push(
        'el objeto del contrato está vacío, así que la nota no se puede componer',
      );
    }
    if (with_note.length === 0) {
      problems.push('ninguna línea lleva la nota del contrato');
    }
    if (with_note.length > 1) {
      problems.push(
        `la nota aparece en ${with_note.length} líneas y el anexo la pide sólo en la de Administración`,
      );
    }
    if (with_note.length === 1 && !with_note[0].text.startsWith(DIAN_AIU_NOTE_PREFIX)) {
      problems.push(
        `la nota no empieza por el literal exacto «${DIAN_AIU_NOTE_PREFIX}»`,
      );
    }
    if (
      note.length > 0 &&
      (note.length < DIAN_AIU_NOTE_MIN_LENGTH ||
        note.length > DIAN_AIU_NOTE_MAX_LENGTH)
    ) {
      problems.push(
        `la nota mide ${note.length} caracteres y el anexo exige entre ${DIAN_AIU_NOTE_MIN_LENGTH} y ${DIAN_AIU_NOTE_MAX_LENGTH}`,
      );
    }

    return {
      rule: 'CAV03',
      passed: problems.length === 0,
      severity: 'blocker',
      code: problems.length === 0 ? null : ErrorCodes.INVOICING_AIU_002.code,
      message:
        problems.length === 0
          ? 'La línea de Administración lleva la nota del objeto del contrato con el prefijo y la longitud que exige el anexo.'
          : `La nota del contrato AIU no cumple el anexo: ${problems.join('; ')}. Un documento AIU ` +
            'sin esta nota se rechaza con el consecutivo ya gastado.',
      details: {
        note_length: note.length,
        lines_with_note: with_note.map((entry) => entry.index),
      },
    };
  }

  /**
   * Las divergencias AIU del calculador, traducidas a las compuertas reales.
   *
   * Cada una tiene detrás una compuerta que RECHAZA la emisión, y el código va en
   * `code` para que el editor pueda decir exactamente qué error vería el operador
   * al intentar emitir. Que la previsualización y la emisión citen el mismo código
   * es lo que hace que el aviso sea creíble.
   */
  private checkAiuDivergences(
    calculation: InvoiceCalculatorResult,
  ): ProfilePreviewValidation[] {
    const by_scope = (scope: string) =>
      calculation.divergences.filter((d) => d.scope === scope);

    const below = by_scope('aiu_base_below_minimum');
    const untaxable_declares = by_scope('aiu_untaxable_line_declares_tax');
    const taxable_without = by_scope('aiu_taxable_line_without_tax');

    return [
      {
        rule: 'AIU-PISO-LEGAL',
        passed: below.length === 0,
        severity: 'blocker',
        code: below.length === 0 ? null : ErrorCodes.INVOICING_AIU_001.code,
        message:
          below.length === 0
            ? `El AIU declarado (${calculation.aiu?.aiu_value ?? '0.00'}) alcanza el piso legal (${calculation.aiu?.minimum_base ?? '0.00'}).`
            : `El AIU declarado (${calculation.aiu?.aiu_value ?? '0.00'}) queda por debajo del piso ` +
              `legal de ${calculation.aiu?.minimum_base ?? '0.00'} (art. 462-1 E.T.). El valor del ` +
              'contrato incluye el costo reembolsable, así que agregar costo sin subir el AIU baja la ' +
              'proporción.',
        details: { divergences: below },
      },
      {
        rule: 'AIU-GRAVABILIDAD',
        passed: untaxable_declares.length === 0,
        severity: 'blocker',
        code:
          untaxable_declares.length === 0
            ? null
            : ErrorCodes.INVOICING_AIU_005.code,
        message:
          untaxable_declares.length === 0
            ? 'Ninguna línea fuera de la base gravable declara impuesto.'
            : 'Hay líneas que declaran impuesto sin hacer parte de la base gravable del régimen. El ' +
              'importe quedaría en el total del documento sin respaldo en ninguna línea.',
        details: { divergences: untaxable_declares },
      },
      {
        rule: 'AIU-SUBDECLARACION',
        passed: taxable_without.length === 0,
        severity: 'blocker',
        code:
          taxable_without.length === 0
            ? null
            : ErrorCodes.INVOICING_AIU_004.code,
        message:
          taxable_without.length === 0
            ? 'Toda línea gravable declara su impuesto.'
            : 'Hay líneas que el régimen SÍ grava y no declaran impuesto. La DIAN aceptaría el ' +
              'documento declarando menos IVA del debido, y el faltante sólo se corregiría con nota ' +
              'crédito.',
        details: { divergences: taxable_without },
      },
    ];
  }

  // ─── Lectura del DOM ────────────────────────────────────────────────────

  /**
   * Descendientes con ese nombre local, **en orden de documento**.
   *
   * ## Por qué por `localName` y no por `cbc:`/`cac:`
   *
   * La primera versión llamaba a `getElementsByTagName('cbc:X')` y a
   * `getElementsByTagName('cac:X')` y concatenaba las dos listas. Compilaba,
   * devolvía los nodos correctos… y **perdía el orden de documento**: todos los
   * `cbc:` quedaban delante de todos los `cac:`. Sobre `InvoiceLine` no se notaba
   * —no hay `cbc:InvoiceLine`— pero cualquier regla futura que dependa del orden
   * relativo habría leído un documento reordenado, y ése es el peor tipo de
   * defecto: el que da la respuesta correcta hasta que deja de darla.
   *
   * Filtrar `'*'` por `localName` es correcto por construcción, no por suerte:
   * respeta el orden, no depende del prefijo que el builder eligió, y sigue
   * funcionando si algún día se emite con otro.
   */
  private elements(node: any, local_name: string): any[] {
    if (!node || typeof node.getElementsByTagName !== 'function') return [];
    const all = node.getElementsByTagName('*');
    const out: any[] = [];
    for (let i = 0; i < all.length; i += 1) {
      const candidate = all[i];
      const name: string =
        candidate.localName ??
        String(candidate.nodeName ?? '').split(':').pop() ??
        '';
      if (name === local_name) out.push(candidate);
    }
    return out;
  }

  /** El primer descendiente con ese nombre local, o `null`. */
  private firstElement(node: any, local_name: string): any {
    return this.elements(node, local_name)[0] ?? null;
  }

  /**
   * Texto del primer descendiente con ese nombre local, o `''`.
   *
   * **Siempre acotado a un padre concreto** por quien lo llama. Nombres como
   * `LineExtensionAmount` y `TaxAmount` aparecen varias veces en el mismo
   * documento —cinco y ocho veces en la muestra de 4 líneas—, así que leerlos
   * desde la raíz devuelve el de la primera línea creyendo que es el de
   * cabecera. Ése fue el descuadre falso de FAU04.
   */
  private textOf(node: any, local_name: string): string {
    const found = this.firstElement(node, local_name);
    return found ? String(found.textContent ?? '').trim() : '';
  }

  /**
   * `true` si el nodo cuelga de un `cac:InvoiceLine`.
   *
   * Es lo que separa el `cac:TaxTotal` de CABECERA de los de línea, que llevan
   * el mismo nombre. Sin esta distinción, la suma de las bases gravables de
   * cabecera incluiría también las de cada línea y saldría al doble — un
   * descuadre inventado sobre un documento correcto.
   */
  private isInsideInvoiceLine(node: any): boolean {
    let current = node?.parentNode;
    while (current) {
      const name: string =
        current.localName ??
        String(current.nodeName ?? '').split(':').pop() ??
        '';
      if (name === 'InvoiceLine') return true;
      current = current.parentNode;
    }
    return false;
  }
}

/** Una línea de la muestra, ya normalizada al vocabulario interno. */
interface SampleLine {
  index: number;
  bucket: AiuBucket;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  unit_code: string;
}
