import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DianNumericInput,
  dianAmount,
  dianLineExtension,
  dianRate,
  dianSum,
  toDecimal,
} from '../utils/dian-money.util';
import {
  DIAN_TAX_CODES,
  DIAN_TAX_NAMES,
} from '../providers/dian-direct/constants/dian-tax-codes';
import { UblCommonBuilder } from '../providers/dian-direct/xml/ubl-common.builder';
import type { ProviderInvoiceTax } from '../providers/invoice-provider.interface';
import { isAiuLineTaxable } from '../profiles/invoice-profile-config.contract';
import type {
  AiuComponentLiteral,
  AiuComponentsBasis,
  AiuTaxableBasis,
} from '../profiles/invoice-profile-config.contract';

/**
 * MOTOR ARITMÉTICO ÚNICO DE UN DOCUMENTO FISCAL DIAN.
 *
 * ## Por qué existe
 *
 * `InvoicingService.create()` persistía el impuesto que le mandara el cliente:
 *
 * ```ts
 * const line_tax_amount = item.taxes
 *   ? item.taxes.reduce((acc, t) => acc + (t.tax_amount || 0), 0)
 *   : item.tax_amount || 0;
 * ```
 *
 * Y el formulario del panel manda literalmente `tax_amount: 0, // el backend
 * recalcula`. El backend no recalculaba. El resultado no era un número feo en
 * pantalla: era una factura con IVA cero persistida, un asiento contable
 * descuadrado, un `ValImp1` incorrecto DENTRO del hash CUFE —que la DIAN
 * recomputa desde el XML que recibe— y el rechazo del documento por la regla
 * aritmética, quemando un consecutivo autorizado que no se recupera.
 *
 * Este servicio hace del SERVIDOR la única fuente de verdad de bases,
 * impuestos, descuentos y totales. Lo que el cliente mande en `tax_amount`
 * pasa a ser **informativo**: se contrasta y se reporta la divergencia, nunca
 * se persiste.
 *
 * ## Qué es (y qué no)
 *
 * PURO a propósito: `@Injectable()` para poder inyectarlo, pero sin Prisma, sin
 * contexto de tenant, sin HTTP y sin excepciones. Entra data, sale data. Todo
 * lo que huele a política —rechazar el documento, avisar al usuario, corregir
 * en silencio— lo decide el llamador leyendo `divergences`. Un servicio que
 * lanza `VendixHttpException` no se puede testear sin levantar Nest, y la
 * aritmética fiscal es exactamente lo que hay que poder testear a mano.
 *
 * NO decide **si** una retención aplica: eso es `WithholdingResolverService`
 * (umbral UVT, calidad de agente retenedor, régimen de las dos partes). Este
 * servicio solo calcula el importe de las retenciones que el llamador ya
 * resolvió, y las devuelve por separado.
 *
 * ## Las tres reglas que gobiernan el resultado
 *
 * 1. **Todo en `Prisma.Decimal`.** Ni una operación monetaria sobre `number`.
 *    Sumar dinero con `+` sobre coma flotante es cómo `0.1 + 0.2` se convierte
 *    en un peso de diferencia contra la DIAN en una factura de 40 líneas.
 * 2. **Truncar, no redondear** — Anexo Técnico 1.9 §11.2. Delegado entero a
 *    `dian-money.util.ts`, que ya resuelve el truncado `ROUND_DOWN`, la escala
 *    forzada y el `-0.00`. Acá no se reimplementa nada de eso.
 * 3. **Truncar HOJA por HOJA y luego sumar.** Ver §"Orden de truncado".
 *
 * @see apps/backend/src/domains/store/invoicing/utils/dian-money.util.ts
 * @see docs/facturacion-electronica-dian-software-propio.md
 */

// --- Constantes en espacio Decimal (nunca `number` en la aritmética) ---

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
/** Tolerancia de la comparación cliente↔servidor: un centavo. */
const ONE_CENT = new Prisma.Decimal('0.01');
const PERCENT_DIVISOR = new Prisma.Decimal(100);
const PER_MIL_DIVISOR = new Prisma.Decimal(1000);
/** Piso legal de la base gravable AIU — E.T. art. 462-1: 10 % del contrato. */
/**
 * Piso legal del AIU: 10 % del valor del contrato (E.T. art. 462-1). Se exporta
 * porque el SNAPSHOT que la factura congela tiene que guardar el porcentaje
 * EFECTIVO, no `null` cuando la tienda no lo declaró: una re-verificación que
 * tenga que volver a derivar el default no es una re-verificación del mismo
 * dato, es una segunda derivación que puede divergir.
 */
export const DEFAULT_AIU_MINIMUM_PERCENT = new Prisma.Decimal(10);

/**
 * Tipos fiscales que son RETENCIÓN, no impuesto del documento.
 *
 * Se listan `withholding` (el valor del enum persistido `tax_type_enum` para
 * retefuente) y `retefuente` (el valor que usa `WithholdingLine` en
 * `common/interfaces/withholding-breakdown.interface.ts`). Los dos contratos
 * conviven en el repo y este servicio recibe de ambos lados.
 */
const RETENTION_TAX_TYPES: ReadonlySet<string> = new Set([
  'withholding',
  'retefuente',
  'reteiva',
  'reteica',
]);

/** Esquemas DIAN que el CUFE hashea nominalmente (`CodImp1/2/3`). */
const CUFE_SCHEME_ORDER: readonly string[] = [
  DIAN_TAX_CODES.IVA,
  DIAN_TAX_CODES.INC,
  DIAN_TAX_CODES.ICA,
];

// --- Contrato público: entradas ---

/**
 * Unidad en la que viene expresada una tarifa.
 *
 * `percent` — 19 significa 19 %. Es lo que declara `CreateInvoiceTaxDto`.
 * `per_mil` — 7 significa 7 ‰ (= 0,7 %). Es cómo Vendix guarda el ICA: ver
 * `ica.service.ts` (`amount * (rate_per_mil / 1000)`) y la conversión ‰→% que
 * `UblCommonBuilder.buildTaxTotals` hace al escribir `cbc:Percent`. Aplicar
 * `/100` a una tarifa por mil cobra diez veces el ICA que corresponde.
 */
export type InvoiceTaxRateBasis = 'percent' | 'per_mil';

/** Un impuesto declarado sobre una línea. */
export interface InvoiceCalculatorTaxInput {
  /** `tax_rates.id` de origen, si lo hay. Viaja intacto al resultado. */
  tax_rate_id?: number | null;
  tax_name: string;
  /** Tarifa en la unidad que declare `rate_basis` (por defecto, ver `resolveRateBasis`). */
  tax_rate: DianNumericInput;
  /** Clasificación fiscal (`iva` | `inc` | `ica` | retenciones). Ausente ⇒ `iva`. */
  tax_type?: string | null;
  /**
   * El precio unitario YA CONTIENE este impuesto. Ausente ⇒ hereda el flag de
   * la línea; si la línea tampoco lo declara, ADICIONAL (compatibilidad).
   */
  is_inclusive?: boolean | null;
  /**
   * Base gravable EXPLÍCITA de este impuesto. Ausente ⇒ la base neta de la
   * línea. Existe porque en un mismo renglón el IVA y el INC pueden gravar
   * bases distintas (régimen AIU: el IVA grava solo la utilidad).
   */
  taxable_amount?: DianNumericInput;
  /**
   * Lo que el cliente AFIRMA que vale este impuesto.
   *
   * **Informativo.** No se persiste ni se suma: se contrasta contra el valor
   * recalculado y, si difiere en más de un centavo, sale en `divergences`.
   */
  tax_amount?: DianNumericInput;
  /** Fuerza la unidad de la tarifa cuando el default no aplica. */
  rate_basis?: InvoiceTaxRateBasis;
}

/**
 * Componente AIU de una línea. Espeja `aiu_component_enum` de Prisma.
 *
 * `'contrato'` (D.2/D.4, ADR-6) es distinto de los otros tres: NO es una
 * porción física del AIU, es la declaración de que la línea ES el AIU
 * COMPLETO (Modelo 1 / `accounting_model: 'no_sumada'`) en vez de venir
 * partido en tres renglones (Modelo 2 / `'sumada'`, el único habilitado hoy).
 * `calculateLine` la explota internamente en A/I/U —ver
 * `explodeAiuContratoLine`— para poder decidir cuánto de su propio importe
 * entra a la base gravable bajo `taxable_basis: 'utilidad'`.
 */
export type AiuComponent =
  | 'administracion'
  | 'imprevistos'
  | 'utilidad'
  | 'contrato';

/**
 * Declaración de que el DOCUMENTO se factura bajo la modalidad AIU
 * (`invoices.operation_type = '09'`, `cbc:CustomizationID = '09'`).
 *
 * Su presencia es lo que activa la segregación de la base gravable por
 * componente. Ausente ⇒ documento normal, y `items[].aiu_component` se ignora.
 */
export interface InvoiceCalculatorAiuInput {
  /**
   * Qué porción entra a la base gravable del IVA. Ver `AiuTaxableBasis`: es
   * configuración explícita de la tienda porque depende del CONTRATO y porque
   * equivocarse no produce ningún error visible, sólo menos —o de más— IVA
   * declarado.
   *
   * · `'aiu'` — A+I+U completo, con piso legal (espejo de `regime: 'et_462_1'`).
   * · `'utilidad'` — sólo la Utilidad, sin piso (espejo de
   *   `regime: 'decreto_1372_1992'`).
   * · `'subtotal'` — se declina el tratamiento AIU: TODA línea graba, incluida
   *   la de costo reembolsable. No tiene régimen legal asociado.
   */
  taxable_basis: AiuTaxableBasis;
  /**
   * Exigir el piso del 10 % del valor del contrato (E.T. art. 462-1). Sólo
   * aplica bajo `et_462_1`; el Decreto 1372/1992 no fija piso.
   */
  enforce_minimum_base?: boolean;
  /** Porcentaje del piso. Ausente ⇒ 10. */
  minimum_base_percent?: DianNumericInput;
  /**
   * Reparto A/I/U configurado en el perfil (D.4). Sólo lo usa una línea
   * `aiu_component: 'contrato'` bajo `taxable_basis: 'utilidad'` —es lo único
   * que necesita saber CUÁNTO de su propio importe es Utilidad—. Ausente en
   * un documento sin líneas `'contrato'`, y también a salvo si falta: ver
   * `explodeAiuContratoLine` (cae todo en Utilidad, el lado que nunca
   * sub-declara IVA).
   */
  components?: Readonly<Partial<Record<AiuComponentLiteral, DianNumericInput>>>;
  /**
   * Unidad de `components` — ver {@link AiuComponentsBasis} y
   * `resolveAiuComponentsBasis`. `explodeAiuContratoLine` normaliza por la
   * SUMA de los tres porcentajes, así que el reparto INTERNO de la línea
   * `'contrato'` da el mismo resultado midan 'contract' o 'aiu': la unidad
   * sólo cambia qué representa la suma (el AIU completo, o su fracción del
   * contrato), nunca la proporción entre Administración/Imprevistos/Utilidad.
   * Se conserva el campo para que la intención quede explícita y para no
   * tener que reabrir esta interfaz si algún caso futuro sí necesita
   * distinguir la unidad.
   */
  components_basis?: AiuComponentsBasis | null;
}

/** Una línea del documento. */
export interface InvoiceCalculatorLineInput {
  /** Solo para poder señalar la línea en una divergencia. */
  description?: string;
  /**
   * Componente AIU al que pertenece la línea. Sólo se lee cuando el documento
   * declara `aiu`.
   *
   * NULL en un documento AIU **no es un error**: es la porción de COSTO
   * reembolsable del contrato (nómina del personal de aseo, insumos…), que no
   * hace parte del AIU y por tanto nunca entra a la base gravable. En un
   * contrato de aseo por $100M con AIU de $10M, los $90M restantes son
   * exactamente esas líneas.
   */
  aiu_component?: AiuComponent | null;
  quantity: DianNumericInput;
  unit_price: DianNumericInput;
  discount_amount?: DianNumericInput;
  /**
   * A cuántas unidades de `quantity` corresponde `unit_price`
   * (`products.price_unit_quantity`). Se delega íntegro a `dianLineExtension`.
   */
  price_unit_quantity?: DianNumericInput;
  /** Default de `is_inclusive` para los impuestos de esta línea. */
  is_inclusive?: boolean | null;
  taxes?: InvoiceCalculatorTaxInput[];
  /**
   * Camino legacy: un único importe de impuesto por línea, SIN tarifa.
   *
   * **Informativo, y además irrecalculable**: sin tarifa no hay nada de dónde
   * derivar el impuesto, así que la línea sale con impuesto cero y una
   * divergencia `untaxed_line_with_amount`. Ver la nota en ese scope.
   */
  tax_amount?: DianNumericInput;
}

/**
 * Retención YA RESUELTA por `WithholdingResolverService`.
 *
 * ⚠️ La tarifa se declara acá en la unidad de `rate_basis` (porcentaje por
 * defecto), NO como la fracción decimal que usa `WithholdingLine.rate`
 * (`0.025` = 2,5 %). Son dos contratos distintos que conviven en el repo;
 * quien puentee `WithholdingLine` hacia acá tiene que multiplicar por 100 o
 * declarar la tarifa tal cual y no pasar por este campo.
 */
export interface InvoiceCalculatorWithholdingInput {
  /** `withholding` / `retefuente` | `reteiva` | `reteica`. */
  withholding_type: string;
  concept_code?: string;
  rate: DianNumericInput;
  rate_basis?: InvoiceTaxRateBasis;
  /**
   * Base de la retención. Ausente ⇒ default legal: `reteiva` retiene sobre el
   * IVA del documento; el resto, sobre la base gravable
   * (`total_before_tax`).
   */
  base?: DianNumericInput;
  /** Lo que el cliente afirma. Informativo, igual que `tax_amount`. */
  amount?: DianNumericInput;
}

export interface InvoiceCalculatorInput {
  items: InvoiceCalculatorLineInput[];
  /** Retenciones aplicables. NUNCA restan del total. Ver `withholdings`. */
  withholdings?: InvoiceCalculatorWithholdingInput[];
  /**
   * Anticipos ya recibidos (`cbc:PrepaidAmount`). Informativo desde el Anexo
   * Técnico 1.8: tampoco resta del total.
   */
  prepaid_amount?: DianNumericInput;
  /**
   * Declara el documento como AIU. Ausente ⇒ documento estándar.
   * Ver {@link InvoiceCalculatorAiuInput}.
   */
  aiu?: InvoiceCalculatorAiuInput;
}

// --- Contrato público: salidas ---

/** Un impuesto ya recalculado. Todos los importes en formato DIAN (2 dec., truncado). */
export interface CalculatedTax {
  tax_rate_id?: number | null;
  tax_name: string;
  /** Normalizado en minúsculas; `iva` cuando el cliente no declara nada. */
  tax_type: string;
  /** Esquema DIAN resuelto por `UblCommonBuilder.resolveTaxCodeFromTax`. */
  dian_tax_code: string;
  /** Tarifa formateada, en su unidad original (ver `rate_basis`). */
  tax_rate: string;
  rate_basis: InvoiceTaxRateBasis;
  is_inclusive: boolean;
  taxable_amount: string;
  tax_amount: string;
}

/** Una línea ya recalculada. */
export interface CalculatedLine {
  /** Índice 0-based en `input.items`, para poder mapear de vuelta al DTO. */
  index: number;
  description?: string;
  /**
   * `quantity × unit_price / price_unit_quantity`, ANTES de descuento y **tal
   * como fue capturado**: si la línea es `is_inclusive`, este importe lleva el
   * impuesto dentro. Informativo — no lo persistas como `subtotal_amount`
   * cuando la línea es inclusiva; para eso está `line_extension_amount`.
   */
  gross_amount: string;
  /** Descuento tal como fue capturado (inclusivo si la línea lo es). */
  discount_amount: string;
  /**
   * `gross − discount`, todavía en la moneda capturada (con impuesto dentro si
   * la línea es inclusiva). Es lo que `dianLineExtension` produce y lo que el
   * builder UBL escribe hoy.
   */
  net_entered_amount: string;
  /**
   * **La base gravable.** `cac:InvoiceLine/cbc:LineExtensionAmount`.
   *
   * Igual a `net_entered_amount` cuando el precio es exclusivo; despejada hacia
   * atrás cuando es inclusivo (ver `resolveTaxableBase`).
   */
  line_extension_amount: string;
  taxes: CalculatedTax[];
  /** Σ de `taxes[].tax_amount`. */
  tax_amount: string;
  /**
   * `line_extension_amount + tax_amount`. NO resta retención ni anticipo.
   */
  total_amount: string;
  /** El flag efectivo de la línea (declarado, o derivado de sus impuestos). */
  is_inclusive: boolean;
  /** Componente AIU declarado. `null` en documentos normales. */
  aiu_component: AiuComponent | null;
  /**
   * La línea NO puede emitir el grupo `cac:TaxTotal` de línea (Anexo Técnico
   * 1.9, regla CAX01: emitirlo en una línea que no hace parte de la base
   * gravable es motivo de rechazo).
   *
   * `true` únicamente en documentos AIU, para las líneas cuyo componente queda
   * fuera de la base del régimen vigente. Es un dato SEPARADO de
   * `taxes.length === 0`, y esa separación es deliberada: una línea de bien
   * EXENTO también se queda sin impuesto, y ésa sí debe emitir su
   * `cac:TaxTotal` con `cbc:Percent` en 0,00 —exento no es excluido—. Colapsar
   * los dos casos en «no tiene impuestos» borraría la diferencia justo donde
   * cambia el resultado.
   *
   * **Derivado de `taxable_amount`, no un dato independiente**: es
   * exactamente el caso `taxable_amount === '0.00'`. Se conserva como campo
   * propio — y no como getter — porque los consumidores existentes ya leen
   * `omit_tax_total` y no tienen por qué cambiar (ADR-7, D.3).
   */
  omit_tax_total: boolean;
  /**
   * **Base gravable declarada de ESTA línea** — de donde sale
   * `cbc:TaxableAmount` en el armado UBL (ADR-7). Ausente hasta D.3; con este
   * campo, `omit_tax_total` deja de ser la única fuente de la gravabilidad de
   * línea.
   *
   * Hoy (modelo `'sumada'`, el único habilitado — ver `ENABLED_ACCOUNTING_
   * MODELS`) coincide siempre con `line_extension_amount` cuando la línea
   * grava, y es `'0.00'` cuando `omit_tax_total` es `true`: el AIU sigue
   * siendo LÍNEAS del documento, así que la base de cada línea es su propio
   * importe entero o nada.
   *
   * El Modelo 1 (`'no_sumada'`, D.4-D.7) es lo que vuelve este campo capaz de
   * declarar una base MENOR que `line_extension_amount` — una línea que ES el
   * contrato entero pero cuya base gravable es sólo la fracción AIU —, sin que
   * `omit_tax_total` deje de significar lo mismo que siempre significó.
   */
  taxable_amount: string;
}

/** Agregado por esquema DIAN — exactamente los `ValImp` del CUFE. */
export interface CalculatedTaxScheme {
  /** `'01'` IVA · `'04'` INC · `'03'` ICA · otros. */
  dian_tax_code: string;
  scheme_name: string;
  taxable_amount: string;
  tax_amount: string;
}

/** Retención calculada. Vive aparte del total a propósito. */
export interface CalculatedWithholding {
  withholding_type: string;
  concept_code?: string;
  rate: string;
  rate_basis: InvoiceTaxRateBasis;
  base: string;
  amount: string;
}

/**
 * Alcance de una divergencia entre lo que el cliente mandó y lo que el
 * servidor calculó.
 */
export type InvoiceCalculatorDivergenceScope =
  /** El `tax_amount` de un impuesto de línea no coincide con el recalculado. */
  | 'line_tax'
  /**
   * La línea trae `tax_amount` legacy pero ningún impuesto con tarifa. No hay
   * nada de dónde recalcular: sale con impuesto cero. Recomendación de
   * cableado: **rechazar** el request. Un importe de impuesto sin tarifa no
   * puede producir un `cac:TaxSubtotal` válido (la DIAN exige `cbc:Percent`).
   */
  | 'untaxed_line_with_amount'
  /**
   * Vino una RETENCIÓN disfrazada de impuesto dentro de `items[].taxes[]`
   * (`CreateInvoiceTaxDto.tax_type` admite `withholding|reteiva|reteica`).
   * Se saca del cálculo del documento y se trata como retención. Sin este
   * corte, `resolveTaxCodeFromTax` caería al heurístico por nombre y un
   * "ReteICA" se clasificaría como ICA (`'03'`), contaminando `ValImp3` del
   * CUFE con un valor que no es un impuesto del documento.
   */
  | 'withholding_as_tax'
  /** El `amount` declarado de una retención no coincide con el recalculado. */
  | 'withholding_amount'
  /**
   * Documento AIU: la línea NO hace parte de la base gravable del régimen
   * vigente pero venía con impuestos declarados. Se le quitan (§CAX01: emitir
   * `cac:TaxTotal` en esa línea es rechazo). Gana el servidor, no bloquea: el
   * formulario manda IVA en todas las líneas por defecto.
   */
  | 'aiu_untaxable_line_declares_tax'
  /**
   * Documento AIU: la línea SÍ hace parte de la base gravable del régimen
   * vigente y salió sin un solo impuesto.
   *
   * Es la simétrica de la anterior y hasta ahora no existía, así que el hueco
   * sólo se abría en un sentido: quitar un impuesto de más se reportaba, y
   * dejar de cobrar uno obligatorio pasaba en silencio. Bajo `'aiu'` la base
   * es el AIU COMPLETO —A, I y U—, de modo que una factura con IVA sólo en
   * Administración sub-declara el impuesto de las otras dos líneas. La DIAN la
   * acepta sin chistar: el XML cuadra consigo mismo, y el error sólo aparece en
   * una fiscalización, cuando ya sólo se corrige con nota crédito.
   *
   * La línea SIN componente también la produce, pero sólo bajo `'subtotal'`:
   * ahí el costo reembolsable ENTRA a la base gravable, así que capturarlo sin
   * impuesto es la misma sub-declaración —y sobre el 90 % del contrato, no
   * sobre el 10 %—. En ese caso `tax_type` viaja ausente, porque no hay
   * componente que nombrar. El predicado que la decide es `omit_tax_total`, no
   * la presencia de componente: ver la nota en `calculateLine`.
   *
   * Este servicio nunca lanza: informa. La decisión de no emitir la toma
   * `InvoicingService.recalculateDocument`, que convierte esta divergencia en
   * `INVOICING_AIU_004` y **sí bloquea** la captura —entre emitir
   * sub-declarando y no emitir, no emitir es la única opción defendible—, y
   * `InvoiceFlowService.assertAiuLineTaxCoherence` la vuelve a cortar antes de
   * firmar para los documentos creados antes de ese bloqueo. Un servicio
   * realmente exento se declara con tarifa 0, que emite su grupo y no produce
   * esta divergencia; omitir el impuesto no es lo mismo que declararlo en cero.
   */
  | 'aiu_taxable_line_without_tax'
  /**
   * Documento AIU bajo E.T. art. 462-1: la base gravable (A+I+U) quedó por
   * DEBAJO del piso legal del 10 % del valor del contrato.
   *
   * Divergencia de CABECERA (`line_index: -1`). Recomendación de cableado:
   * **rechazar**. No se infla la base en silencio —eso cambiaría el importe que
   * el cliente firmó— y no se puede dejar pasar: emitiría un documento que
   * declara menos IVA del que la ley exige, que la DIAN acepta sin chistar y
   * que sólo se corrige con nota crédito.
   */
  | 'aiu_base_below_minimum'
  /**
   * D.4 — un documento mezcló el Modelo 1 (`aiu_component: 'contrato'`) con el
   * Modelo 2 (líneas `administracion`/`imprevistos`/`utilidad`), o declaró
   * MÁS de una línea `'contrato'`.
   *
   * Las dos formas son mutuamente excluyentes por construcción (ADR-6): una
   * línea `'contrato'` YA ES el AIU completo del contrato, así que una
   * segunda línea de cualquiera de los dos tipos duplicaría —o
   * contradiría— cuánto vale el AIU que `summarizeAiu` usa para el piso legal
   * del 10 % (E.T. art. 462-1). No hay lectura razonable que reconcilie las
   * dos declaraciones sin adivinar cuál de las dos miente, así que este
   * servicio no intenta arbitrar: informa, y `InvoicingService` bloquea con
   * `INVOICING_AIU_007` antes de gastar numeración. `line_index` señala la
   * primera línea 'contrato' cuando hay más de una, o la primera línea que
   * mezcla componentes cuando el documento combina los dos modelos.
   */
  | 'aiu_contrato_mutually_exclusive';

export interface InvoiceCalculatorDivergence {
  scope: InvoiceCalculatorDivergenceScope;
  /** Índice 0-based de la línea; `-1` cuando la divergencia es de cabecera. */
  line_index: number;
  line_description?: string;
  tax_name?: string;
  tax_type?: string;
  /** Lo que el servidor calculó. Es lo que se persiste. */
  expected: string;
  /** Lo que el cliente mandó. */
  received: string;
  /** `received − expected`. */
  difference: string;
}

/** Totales de cabecera. Nombres alineados con `CufeParams` para cablear 1:1. */
export interface InvoiceCalculatorTotals {
  /**
   * Σ `gross_amount` — el `subtotal` histórico de `InvoicingService`.
   *
   * ⚠️ Con líneas inclusivas este número lleva impuesto dentro. Para
   * `invoices.subtotal_amount` usá `total_before_tax`, que es la base gravable
   * real y lo único que la DIAN valida.
   */
  gross_subtotal: string;
  /** Σ `discount_amount` tal como fue capturado. */
  discount_amount: string;
  /**
   * `ValFac` del CUFE y `cac:LegalMonetaryTotal/cbc:LineExtensionAmount`.
   * Σ de `line_extension_amount`.
   */
  total_before_tax: string;
  /** Σ de todos los impuestos = `cac:TaxTotal/cbc:TaxAmount`. */
  tax_amount: string;
  /** `ValImp1` — esquema `'01'`. */
  tax_iva: string;
  /** `ValImp2` — esquema `'04'`. */
  tax_inc: string;
  /** `ValImp3` — esquema `'03'`. */
  tax_ica: string;
  /** Esquemas fuera de 01/03/04. Alimenta `ValOtroIm` del QR junto a INC e ICA. */
  tax_other: string;
  /** `cbc:TaxInclusiveAmount` = `total_before_tax + tax_amount`. */
  tax_inclusive_amount: string;
  /**
   * `ValTot` del CUFE y `cbc:PayableAmount`.
   *
   * Idéntico a `tax_inclusive_amount`: **la retención y el anticipo NO se
   * restan acá**. Ver la nota normativa en `calculate()`.
   */
  total_amount: string;
  /** Σ de las retenciones. Informativo — se persiste aparte, no netea. */
  withholding_amount: string;
  /** `cbc:PrepaidAmount`. Informativo — tampoco netea. */
  prepaid_amount: string;
}

/** Resumen del régimen AIU. Sólo presente cuando el documento lo declara. */
export interface CalculatedAiu {
  taxable_basis: AiuTaxableBasis;
  /** Σ `line_extension_amount` de TODAS las líneas — el valor del contrato. */
  contract_value: string;
  /** Σ `line_extension_amount` de las líneas A+I+U, entren o no a la base. */
  aiu_value: string;
  /**
   * Σ `line_extension_amount` de las líneas que SÍ gravan bajo esta base.
   *
   * NO es Σ de las bases de los impuestos calculados: una línea puede entrar a
   * la base gravable y no declarar ninguna tarifa. Cuando eso pasa, este número
   * queda por ENCIMA de lo que `totals.tax_amount` grava, y la respuesta trae
   * una divergencia `aiu_taxable_line_without_tax` por cada línea responsable.
   * Los dos números no pueden contradecirse en silencio: si el cociente no da
   * la tarifa esperada, `divergences` dice exactamente qué línea falta.
   */
  taxable_base: string;
  /** Piso legal exigido (`contract_value × minimum_base_percent`), o `'0.00'`. */
  minimum_base: string;
}

export interface InvoiceCalculatorResult {
  lines: CalculatedLine[];
  /**
   * Filas para `invoice_taxes`, agrupadas por
   * `(tax_name, tax_rate, tax_type, is_inclusive, esquema)`.
   */
  header_taxes: CalculatedTax[];
  /** Agregado por esquema DIAN. Orden estable: 01, 04, 03, luego el resto. */
  tax_schemes: CalculatedTaxScheme[];
  totals: InvoiceCalculatorTotals;
  withholdings: CalculatedWithholding[];
  /** Vacío = el cliente y el servidor coinciden. Nunca lanza; siempre informa. */
  divergences: InvoiceCalculatorDivergence[];
  /** Resumen AIU. Ausente cuando el documento no es AIU. */
  aiu?: CalculatedAiu;
}

@Injectable()
export class InvoiceCalculatorService {
  /**
   * Recalcula el documento completo desde los datos base.
   *
   * ## Orden de truncado: hoja por hoja, luego sumar
   *
   * Truncar cada hoja y sumar NO da lo mismo que sumar y truncar al final, y la
   * aritmética de la DIAN tiene que cuadrar **exactamente**. Acá se trunca cada
   * valor terminal (el importe de línea, el importe de cada impuesto) a 2
   * decimales y se suma hacia arriba en espacio `Decimal`.
   *
   * El motivo no es estético: la DIAN **recomputa los totales desde el XML que
   * recibe**, y el XML ya solo contiene los valores truncados de cada línea y de
   * cada `TaxSubtotal`. La regla `FAU14` exige que
   * `LegalMonetaryTotal/LineExtensionAmount` sea la suma de los
   * `InvoiceLine/LineExtensionAmount` **emitidos**. Si la cabecera se calculara
   * sumando en precisión plena y truncando una sola vez al final, dos líneas de
   * `10,005` producirían `20,00` en el XML (`10,00 + 10,00`) y `20,01` en la
   * cabecera: descuadre y rechazo. Sumar lo ya truncado hace ese descuadre
   * irrepresentable.
   *
   * Por la misma razón el importe neto de línea se toma de `dianLineExtension`
   * y no de una fórmula propia: es la MISMA función con la que el builder UBL
   * escribe `cbc:LineExtensionAmount`. Dos aritméticas para el mismo importe se
   * separan tarde o temprano, igual que dos clasificaciones de impuesto.
   *
   * ## Las retenciones NO restan del total
   *
   * Anexo Técnico 1.9 §11.9.1: *«los cálculos aplicados por la validación
   * previa de la DIAN no incluyen en el fragmento `<cac:LegalMonetaryTotal/>`
   * operaciones con el elemento `<cac:WithholdingTaxTotal/>`»*.
   *
   * Es decir: la DIAN valida `PayableAmount` SIN mirar la retención. Si el
   * emisor la resta de `total_amount`, el total declarado deja de cuadrar con
   * `base + impuestos` y el documento se rechaza por descuadre aritmético. Es
   * el error que cualquiera cometería —contablemente la retención sí reduce lo
   * que el cliente gira— y por eso este servicio la calcula y la devuelve en
   * `withholdings` / `totals.withholding_amount`, **jamás netada**.
   *
   * Lo mismo con el anticipo (`cbc:PrepaidAmount`), informativo desde el
   * Anexo 1.8.
   */
  calculate(input: InvoiceCalculatorInput): InvoiceCalculatorResult {
    const divergences: InvoiceCalculatorDivergence[] = [];
    const lines: CalculatedLine[] = [];
    /** Retenciones que llegaron infiltradas en `items[].taxes[]`. */
    const rescued_withholdings: InvoiceCalculatorWithholdingInput[] = [];

    (input.items ?? []).forEach((item, index) => {
      lines.push(
        this.calculateLine(
          item,
          index,
          divergences,
          rescued_withholdings,
          input.aiu,
        ),
      );
    });

    // D.4 — estructural, no monetario: se corre ANTES de `summarizeAiu` para
    // que el piso legal nunca alcance a leer un `aiu_value` construido sobre
    // una mezcla de modelos.
    this.checkAiuContratoMutualExclusion(lines, divergences);

    const aiu = this.summarizeAiu(lines, input.aiu, divergences);

    const header_taxes = this.aggregateHeaderTaxes(lines);
    const tax_schemes = this.aggregateTaxSchemes(header_taxes);

    const total_before_tax = dianSum(
      lines.map((line) => line.line_extension_amount),
    );
    const tax_amount = dianSum(lines.map((line) => line.tax_amount));
    const tax_iva = this.schemeTotal(tax_schemes, DIAN_TAX_CODES.IVA);
    const tax_inc = this.schemeTotal(tax_schemes, DIAN_TAX_CODES.INC);
    const tax_ica = this.schemeTotal(tax_schemes, DIAN_TAX_CODES.ICA);
    const tax_other = dianSum(
      tax_schemes
        .filter((scheme) => !CUFE_SCHEME_ORDER.includes(scheme.dian_tax_code))
        .map((scheme) => scheme.tax_amount),
    );

    // `PayableAmount`. Sin retención y sin anticipo, a propósito (§11.9.1).
    const total_amount = dianSum([total_before_tax, tax_amount]);

    const withholdings = this.calculateWithholdings(
      [...(input.withholdings ?? []), ...rescued_withholdings],
      total_before_tax,
      tax_iva,
      divergences,
    );

    return {
      lines,
      header_taxes,
      tax_schemes,
      withholdings,
      divergences,
      ...(aiu ? { aiu } : {}),
      totals: {
        gross_subtotal: dianSum(lines.map((line) => line.gross_amount)),
        discount_amount: dianSum(lines.map((line) => line.discount_amount)),
        total_before_tax,
        tax_amount,
        tax_iva,
        tax_inc,
        tax_ica,
        tax_other,
        tax_inclusive_amount: total_amount,
        total_amount,
        withholding_amount: dianSum(withholdings.map((w) => w.amount)),
        prepaid_amount: dianAmount(input.prepaid_amount),
      },
    };
  }

  // --- Línea ---

  private calculateLine(
    item: InvoiceCalculatorLineInput,
    index: number,
    divergences: InvoiceCalculatorDivergence[],
    rescued_withholdings: InvoiceCalculatorWithholdingInput[],
    aiu?: InvoiceCalculatorAiuInput,
  ): CalculatedLine {
    const price_unit_quantity = item.price_unit_quantity;

    // Bruto e importe neto. `dianLineExtension` es la fuente única del neto:
    // divide por la *price unit*, resta el descuento y trunca una sola vez.
    const gross_amount = dianAmount(
      toDecimal(item.quantity)
        .times(toDecimal(item.unit_price))
        .dividedBy(this.priceUnitDivisor(price_unit_quantity)),
    );
    const discount_amount = dianAmount(item.discount_amount);
    const net_entered_amount = dianLineExtension({
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount,
      price_unit_quantity,
    });

    const aiu_component = item.aiu_component ?? null;
    // En un documento AIU la línea sólo grava si su componente entra a la base
    // del régimen vigente. Fuera de un documento AIU la pregunta no existe y
    // toda línea grava normalmente.
    const omit_tax_total = aiu ? !this.isAiuTaxable(aiu_component, aiu) : false;

    // Separar retenciones ANTES de clasificar: un `reteica` que pasara por
    // `resolveTaxCodeFromTax` caería al heurístico por nombre y volvería '03'.
    //
    // El rescate de retenciones ocurre INCLUSO en una línea excluida de la base
    // gravable del AIU, y esa asimetría es deliberada: `omit_tax_total` habla
    // del IVA del documento, mientras que la retención se practica sobre el
    // PAGO. Descartarla junto con el impuesto habría hecho desaparecer, sin
    // rastro, la retención declarada sobre el costo reembolsable de un contrato
    // AIU — que suele ser el 90 % del valor facturado.
    const document_taxes: InvoiceCalculatorTaxInput[] = [];
    const untaxable_declared: InvoiceCalculatorTaxInput[] = [];

    for (const tax of item.taxes ?? []) {
      if (RETENTION_TAX_TYPES.has(this.normalizeTaxType(tax.tax_type))) {
        rescued_withholdings.push({
          withholding_type: this.normalizeTaxType(tax.tax_type),
          rate: tax.tax_rate,
          rate_basis: tax.rate_basis,
          base: tax.taxable_amount,
          amount: tax.tax_amount,
        });
        divergences.push({
          scope: 'withholding_as_tax',
          line_index: index,
          line_description: item.description,
          tax_name: tax.tax_name,
          tax_type: this.normalizeTaxType(tax.tax_type),
          expected: dianAmount(0),
          received: dianAmount(tax.tax_amount),
          difference: dianAmount(tax.tax_amount),
        });
        continue;
      }

      if (omit_tax_total) {
        untaxable_declared.push(tax);
        continue;
      }
      document_taxes.push(tax);
    }

    // La línea excluida de la base venía con impuestos: se los quitamos y se
    // reporta. Gana el servidor sin bloquear, igual que en `line_tax`: el
    // formulario del panel pone IVA en TODAS las líneas por defecto, así que
    // bloquear haría fallar toda factura AIU capturada desde el módulo.
    if (untaxable_declared.length > 0) {
      const received = dianSum(untaxable_declared.map((tax) => tax.tax_amount));
      divergences.push({
        scope: 'aiu_untaxable_line_declares_tax',
        line_index: index,
        line_description: item.description,
        tax_type: aiu_component ?? undefined,
        expected: dianAmount(0),
        received,
        difference: received,
      });
    }

    // La simétrica: la línea SÍ entra a la base y no trae impuesto alguno.
    //
    // Se comprueba sobre `document_taxes` y no sobre `item.taxes`, a propósito:
    // una línea que sólo trajo retenciones ya quedó vacía de impuestos del
    // documento arriba, y es exactamente el caso que hay que reportar. Bajo
    // `et_462_1` la base es el AIU completo, así que Imprevistos y Utilidad sin
    // IVA sub-declaran el impuesto sin que nada en pantalla lo diga.
    //
    // EL PREDICADO ES `!omit_tax_total` Y NADA MÁS. Antes exigía además
    // `aiu_component !== null`, que era una SEGUNDA derivación del mismo hecho
    // —«esta línea entra a la base»— y las dos derivaciones se separaron en el
    // momento en que apareció la base `'subtotal'`: ahí `isAiuTaxable` devuelve
    // `true` para la línea SIN componente (el costo reembolsable), así que la
    // línea entraba a la base gravable y la divergencia la saltaba por no tener
    // componente. Un contrato de 100 M —90 M de costo capturado sin impuesto y
    // 10 M de A/I/U con IVA— salía del calculador con CERO divergencias, se
    // capturaba, tomaba consecutivo, y luego `assertAiuLineTaxCoherence` lo
    // rechazaba al emitir con `INVOICING_AIU_004`: documento inemitible con la
    // numeración ya gastada, que es el daño exacto que este bloque existe para
    // evitar. `omit_tax_total` es el MISMO hecho que usa la compuerta de
    // emisión, y usar el mismo predicado en las dos puntas es lo que hace
    // imposible que vuelvan a discrepar.
    //
    // Bajo `'aiu'` y `'utilidad'` no cambia nada: ahí `isAiuTaxable(null, …)`
    // es `false`, la línea de costo trae `omit_tax_total: true` y no entra a
    // este bloque. No hay falso positivo posible.
    if (aiu && !omit_tax_total && document_taxes.length === 0) {
      divergences.push({
        scope: 'aiu_taxable_line_without_tax',
        line_index: index,
        line_description: item.description,
        // `undefined` cuando la línea no tiene componente: es la porción de
        // costo reembolsable gravada por la base `'subtotal'`. El campo dice de
        // QUÉ parte del contrato se trata, y afirmar un componente que la línea
        // no declara sería peor que dejarlo ausente.
        tax_type: aiu_component ?? undefined,
        // No se puede afirmar CUÁNTO debía: la tarifa depende del bien o
        // servicio y este servicio no la conoce. Los tres importes van en cero
        // —el contrato del tipo los exige— y lo que informa es el hecho.
        expected: dianAmount(0),
        received: dianAmount(0),
        difference: dianAmount(0),
      });
    }

    const line_is_inclusive =
      item.is_inclusive ??
      document_taxes.some((tax) => tax.is_inclusive === true);

    // La base se TRUNCA antes de gravar, no después: la DIAN valida
    // `TaxAmount = TaxableAmount × Percent` contra los valores que van en el
    // XML, y en el XML la base ya viaja con 2 decimales. Calcular la cuota
    // sobre la base en precisión plena produce una cuota que no se puede
    // reproducir desde el documento emitido.
    const line_extension_amount = dianAmount(
      this.resolveTaxableBase(
        toDecimal(net_entered_amount),
        document_taxes,
        line_is_inclusive,
      ),
    );
    const base = toDecimal(line_extension_amount);

    // D.4 — Modelo 1: una línea 'contrato' bajo `taxable_basis: 'utilidad'`
    // sólo tributa su porción Utilidad, no el AIU completo que declara
    // `line_extension_amount`. El resto de combinaciones (`'aiu'`,
    // `'subtotal'`, o cualquier componente que no sea `'contrato'`) no
    // explota nada y sigue el binario 0/completo de siempre.
    const contrato_split =
      aiu && aiu_component === 'contrato' && aiu.taxable_basis === 'utilidad'
        ? this.explodeAiuContratoLine(base, aiu.components)
        : null;
    const contrato_taxable_base = contrato_split
      ? toDecimal(contrato_split.utilidad)
      : base;

    const taxes: CalculatedTax[] = document_taxes.map((tax) => {
      const rate_basis = this.resolveRateBasis(tax);
      const fraction = this.rateFraction(tax.tax_rate, rate_basis);
      // Base propia si el llamador la declaró (AIU, bases disímiles); si no, la
      // base neta de la línea — o, en una línea 'contrato' bajo 'utilidad', su
      // fracción Utilidad (`contrato_taxable_base`). El IVA y el INC de un
      // mismo renglón comparten base salvo que se diga lo contrario.
      const taxable = this.hasTaxableBase(tax.taxable_amount)
        ? toDecimal(dianAmount(tax.taxable_amount))
        : contrato_taxable_base;
      const amount = taxable.times(fraction);
      const computed = dianAmount(amount);

      this.reportTaxDivergence(
        divergences,
        index,
        item.description,
        tax,
        computed,
      );

      return {
        tax_rate_id: tax.tax_rate_id ?? null,
        tax_name: tax.tax_name,
        tax_type: this.normalizeTaxType(tax.tax_type),
        dian_tax_code: this.resolveDianTaxCode(tax),
        tax_rate: dianRate(tax.tax_rate),
        rate_basis,
        is_inclusive: tax.is_inclusive ?? line_is_inclusive,
        taxable_amount: dianAmount(taxable),
        tax_amount: computed,
      };
    });

    // Línea legacy: importe de impuesto sin ninguna tarifa de la que derivarlo.
    //
    // No aplica a una línea AIU fuera de la base: ahí el impuesto cero no es un
    // dato faltante sino el resultado correcto, y bloquear por él impediría
    // emitir la porción de costo de cualquier contrato AIU.
    if (
      !omit_tax_total &&
      document_taxes.length === 0 &&
      this.hasValue(item.tax_amount)
    ) {
      const received = dianAmount(item.tax_amount);
      if (toDecimal(received).abs().greaterThan(ONE_CENT)) {
        divergences.push({
          scope: 'untaxed_line_with_amount',
          line_index: index,
          line_description: item.description,
          expected: dianAmount(0),
          received,
          difference: received,
        });
      }
    }

    const tax_amount = dianSum(taxes.map((tax) => tax.tax_amount));

    // ADR-7 / D.3, actualizado por D.4: la base gravable de la línea es cero
    // cuando `omit_tax_total` la excluye, su propio importe entero cuando
    // grava completa (todo Modelo 2 / `'sumada'`, y 'contrato' bajo 'aiu' o
    // 'subtotal'), y una FRACCIÓN cuando es una línea 'contrato' bajo
    // 'utilidad' — la porción Utilidad que `explodeAiuContratoLine` calculó
    // arriba. Es exactamente el tercer valor que el comentario anterior decía
    // que no existía todavía: el Modelo 1 (D.4) lo introduce AQUÍ, no en el
    // llamador, porque sólo este método conoce `line_extension_amount` antes
    // de truncar y el reparto porcentual que lo explota.
    const taxable_amount = omit_tax_total
      ? dianAmount(0)
      : contrato_split
        ? contrato_split.utilidad
        : line_extension_amount;

    return {
      index,
      description: item.description,
      gross_amount,
      discount_amount,
      net_entered_amount,
      line_extension_amount,
      taxes,
      tax_amount,
      total_amount: dianSum([line_extension_amount, tax_amount]),
      is_inclusive: line_is_inclusive,
      aiu_component,
      omit_tax_total,
      taxable_amount,
    };
  }

  // --- AIU ---

  /**
   * D.4 — un documento no puede mezclar Modelo 1 (`'contrato'`) con Modelo 2
   * (líneas por componente), ni declarar dos líneas `'contrato'`. Ver el
   * docblock del scope `'aiu_contrato_mutually_exclusive'` para el porqué.
   *
   * `expected`/`received`/`difference` no llevan dinero aquí — son un conteo
   * de líneas en conflicto — porque `InvoiceCalculatorDivergence` no tiene un
   * canal separado para divergencias estructurales. `InvoicingService` sólo
   * lee `line_index` y el `scope` para decidir el 422; los tres importes
   * quedan para quien quiera loguear cuántas líneas chocaron.
   */
  private checkAiuContratoMutualExclusion(
    lines: CalculatedLine[],
    divergences: InvoiceCalculatorDivergence[],
  ): void {
    const contrato_indices = lines
      .filter((line) => line.aiu_component === 'contrato')
      .map((line) => line.index);
    const component_indices = lines
      .filter(
        (line) => line.aiu_component !== null && line.aiu_component !== 'contrato',
      )
      .map((line) => line.index);

    if (contrato_indices.length > 1) {
      divergences.push({
        scope: 'aiu_contrato_mutually_exclusive',
        line_index: contrato_indices[1],
        expected: dianAmount(1),
        received: dianAmount(contrato_indices.length),
        difference: dianAmount(contrato_indices.length - 1),
      });
      return;
    }

    if (contrato_indices.length === 1 && component_indices.length > 0) {
      divergences.push({
        scope: 'aiu_contrato_mutually_exclusive',
        line_index: component_indices[0],
        expected: dianAmount(0),
        received: dianAmount(component_indices.length),
        difference: dianAmount(component_indices.length),
      });
    }
  }

  /**
   * ¿La línea entra a la base gravable del IVA bajo la base declarada?
   *
   * D.9 — deja de tener lógica propia: delega en
   * `isAiuLineTaxable` (`invoice-profile-config.contract.ts`), la única
   * derivación de {@link AIU_TAXABLE_BUCKETS_BY_BASIS}. Antes de este cambio
   * esta era una de DOS implementaciones manuales de la misma pregunta —la
   * otra en `InvoiceFlowService.isAiuComponentTaxable`— y divergieron: D.4
   * corrigió acá el caso `component === 'contrato'` bajo `'utilidad'` sin
   * tocar la del flujo de emisión, produciendo un ciclo irrompible
   * (`INVOICING_AIU_005` sobre una línea que este método ya capturaba como
   * correctamente gravada). Ver `isAiuLineTaxable` para las tres bases y las
   * dos reglas que no se leen directo de la tabla (`component === null` y
   * `component === 'contrato'`).
   */
  private isAiuTaxable(
    component: AiuComponent | null,
    aiu: InvoiceCalculatorAiuInput,
  ): boolean {
    return isAiuLineTaxable(component, aiu.taxable_basis);
  }

  /**
   * Explota el importe de una línea `aiu_component: 'contrato'` (Modelo 1,
   * ADR-6/D.2) en sus tres porciones Administración/Imprevistos/Utilidad.
   *
   * ## Por qué el reparto no depende de `components_basis`
   *
   * `ProfileAiuConfig.components` mide los tres porcentajes contra el AIU
   * (`'aiu'`, suman 100) o contra el CONTRATO (`'contract'`, su suma ES el
   * AIU y el resto hasta 100 % es costo reembolsable) — ver
   * `resolveAiuComponentsBasis` y `validateAiuSection`. Una línea `'contrato'`
   * es, por definición (ADR-6), el AIU completo: `line_amount` YA ES el
   * subconjunto que esos tres porcentajes describen, mida lo que mida su
   * SUMA. Por eso normalizar cada porcentaje por la suma de los tres
   * (`pct_i / Σpct`) da la fracción CORRECTA de `line_amount` sin importar la
   * unidad: si se midieron contra el contrato, `Σpct` es qué fracción del
   * contrato es AIU y `pct_i/Σpct` sigue siendo la proporción interna de ese
   * AIU. La unidad cambia qué representa la suma, nunca el reparto entre los
   * tres.
   *
   * ## Por qué Utilidad absorbe el residuo
   *
   * Administración e Imprevistos se truncan a 2 decimales de forma
   * independiente (Anexo Técnico 1.9 §11.2, truncar-hoja-antes-de-sumar).
   * Sumar sus dos truncamientos y restárselos a `line_amount` para obtener
   * Utilidad —en vez de truncar los tres por separado— es lo único que
   * garantiza el CIERRE EXACTO exigido por D.4: las tres porciones deben
   * sumar EXACTAMENTE `line_amount`, nunca un centavo de más o de menos.
   *
   * Sin porcentajes configurados (perfil manual sin sección AIU, o un
   * `contrato` capturado fuera de un perfil), no hay nada que repartir: el
   * lado seguro es declarar TODO el importe como Utilidad —el mismo
   * resultado que ya producía el binario 0/completo anterior a D.4— y nunca
   * un reparto que sub-declare IVA por defecto.
   */
  private explodeAiuContratoLine(
    line_amount: Prisma.Decimal,
    components:
      | Readonly<Partial<Record<AiuComponentLiteral, DianNumericInput>>>
      | undefined,
  ): { administracion: string; imprevistos: string; utilidad: string } {
    const percentOf = (component: AiuComponentLiteral): Prisma.Decimal =>
      this.hasValue(components?.[component])
        ? toDecimal(components![component] as DianNumericInput)
        : new Prisma.Decimal(0);

    const admin_pct = percentOf('administracion');
    const imprevistos_pct = percentOf('imprevistos');
    const utilidad_pct = percentOf('utilidad');
    const sum_pct = admin_pct.plus(imprevistos_pct).plus(utilidad_pct);

    if (sum_pct.lessThanOrEqualTo(0)) {
      return {
        administracion: dianAmount(0),
        imprevistos: dianAmount(0),
        utilidad: dianAmount(line_amount),
      };
    }

    const administracion = dianAmount(
      line_amount.times(admin_pct).dividedBy(sum_pct),
    );
    const imprevistos = dianAmount(
      line_amount.times(imprevistos_pct).dividedBy(sum_pct),
    );
    // Residuo, no tercer truncamiento: ver docblock de este método.
    const utilidad = dianAmount(
      line_amount.minus(toDecimal(administracion)).minus(toDecimal(imprevistos)),
    );

    return { administracion, imprevistos, utilidad };
  }

  /**
   * Resume el AIU del documento y verifica el piso legal del 10 %.
   *
   * ## El piso (E.T. art. 462-1)
   *
   * «…la base gravable estará integrada por el valor total de la remuneración
   * que reciba por la prestación del servicio, sin que en ningún caso pueda ser
   * inferior al diez por ciento (10%) del valor del contrato».
   *
   * El valor del contrato se toma como Σ de todas las líneas — que es lo que el
   * documento declara haber contratado— y el AIU como Σ de las líneas con
   * componente. NO se infla la base cuando queda corta: subirla en silencio
   * cambiaría el IVA que el cliente firmó, y el emisor tiene que enterarse. Se
   * reporta la divergencia y el llamador decide (hoy: rechazar antes de gastar
   * numeración).
   *
   * El piso NO se aplica bajo `decreto_1372_1992`: el Decreto no fija ninguno
   * sobre la utilidad del constructor, y trasplantarle el 10 % del 462-1
   * rechazaría facturas de construcción perfectamente legales.
   *
   * ## `taxable_base` no puede contradecir a `totals.tax_amount` en silencio
   *
   * `taxable_base` suma las líneas que ENTRAN a la base; `totals.tax_amount`
   * suma el impuesto que las líneas DECLARARON. Son dos cosas distintas y
   * pueden legítimamente no guardar la proporción de una tarifa única: bases
   * mixtas, tarifa 0 en un componente exento, INC junto al IVA.
   *
   * Lo que NO puede pasar es que difieran porque una línea de la base llegó sin
   * ninguna tarifa y nadie lo diga. Bajo `'subtotal'` ese era el caso real:
   * `taxable_base` salía en 100.000.000,00 con `tax_amount` en 1.900.000,00
   * —el 19 % de 10 M, no de 100 M— y `divergences` venía vacío, porque la
   * divergencia de captura exigía componente y la línea de costo no lo tiene.
   * Corregido el predicado en `calculateLine` (`!omit_tax_total` a secas), toda
   * línea que suma a `taxable_base` sin declarar impuesto del documento aporta
   * su `aiu_taxable_line_without_tax`. El invariante que sostiene la respuesta
   * es ese: la contradicción sigue siendo posible —la produce el usuario— pero
   * ya no puede viajar sin su divergencia.
   */
  private summarizeAiu(
    lines: CalculatedLine[],
    aiu: InvoiceCalculatorAiuInput | undefined,
    divergences: InvoiceCalculatorDivergence[],
  ): CalculatedAiu | undefined {
    if (!aiu) return undefined;

    const contract_value = dianSum(
      lines.map((line) => line.line_extension_amount),
    );
    const aiu_value = dianSum(
      lines
        .filter((line) => line.aiu_component !== null)
        .map((line) => line.line_extension_amount),
    );
    // D.4: se suma `line.taxable_amount`, no `line_extension_amount` filtrado
    // por `omit_tax_total`. Para TODA línea binaria (Modelo 2, o 'contrato'
    // bajo 'aiu'/'subtotal') `taxable_amount` YA vale exactamente 0 o el
    // importe completo de la línea — son la MISMA suma, cero regresión—. La
    // diferencia sólo aparece en una línea 'contrato' bajo 'utilidad', donde
    // `taxable_amount` es la fracción Utilidad: sumar el importe completo ahí
    // declararía una base gravable mayor a la que el impuesto realmente grava.
    const taxable_base = dianSum(lines.map((line) => line.taxable_amount));

    const enforce =
      aiu.taxable_basis === 'aiu' && aiu.enforce_minimum_base !== false;
    const percent = this.hasValue(aiu.minimum_base_percent)
      ? toDecimal(aiu.minimum_base_percent)
      : DEFAULT_AIU_MINIMUM_PERCENT;
    const minimum_base = enforce
      ? dianAmount(
          toDecimal(contract_value).times(percent).dividedBy(PERCENT_DIVISOR),
        )
      : dianAmount(0);

    // Se compara contra el AIU DECLARADO (A+I+U), no contra la base gravable:
    // bajo `et_462_1` son el mismo número, y escribirlo así deja explícito que
    // el piso mide la remuneración del contratista, no lo que resultó gravado.
    if (enforce && toDecimal(aiu_value).lessThan(toDecimal(minimum_base))) {
      divergences.push({
        scope: 'aiu_base_below_minimum',
        line_index: -1,
        expected: minimum_base,
        received: aiu_value,
        difference: dianAmount(
          toDecimal(aiu_value).minus(toDecimal(minimum_base)),
        ),
      });
    }

    return {
      taxable_basis: aiu.taxable_basis,
      contract_value,
      aiu_value,
      taxable_base,
      minimum_base,
    };
  }

  /**
   * Despeja la base gravable de una línea cuyo precio YA CONTIENE impuesto.
   *
   * ## La fórmula
   *
   *     B = (G − Σ impuestos_inclusivos_con_base_propia) / (1 + Σ tarifas_inclusivas)
   *
   * donde `G` es el importe neto capturado (`net_entered_amount`, con impuesto
   * dentro) y las tarifas van como fracción (0,19 para 19 %).
   *
   * ## Por qué se despeja contra la SUMA de tarifas y no en cascada
   *
   * Con IVA 19 % e INC 8 % inclusivos sobre la misma línea, el precio de
   * mostrador es `B × (1 + 0,19 + 0,08)`: los dos tributos gravan la MISMA base
   * —el valor del bien— y ambos están metidos en el precio. Despejar en cascada
   * (`G / 1,19 / 1,08`) supondría que el INC grava el precio con IVA incluido,
   * que es un impuesto sobre impuesto que la ley colombiana no establece, y
   * produce una base ~1,5 % más baja: menos IVA declarado del que corresponde,
   * y un `ValImp1` que la DIAN no puede reproducir.
   *
   * ## Impuestos exclusivos en la misma línea
   *
   * No participan del divisor: se suman ENCIMA de `B`. Un precio con IVA
   * incluido al que se le agrega ICA aparte da
   * `B = G / 1,19` y `ICA = B × tarifa_ica`.
   *
   * ## Impuestos inclusivos con base propia
   *
   * Su cuota no depende de `B`, así que se saca del numerador en vez de entrar
   * al divisor. Así la identidad `G = B + Σ cuotas` se sostiene también en el
   * caso mixto.
   *
   * ## El centavo que se pierde
   *
   * `B` se trunca (§11.2) y cada cuota se calcula sobre la `B` truncada, así que
   * `B + Σ cuotas` puede quedar hasta un centavo por debajo del precio inclusivo
   * de mostrador. Es deliberado: la DIAN valida `TaxAmount = TaxableAmount ×
   * Percent`, así que absorber el residuo inflando una cuota rompería la regla
   * aritmética. Cuadrar con la DIAN pesa más que cuadrar con la etiqueta.
   */
  private resolveTaxableBase(
    net_entered: Prisma.Decimal,
    taxes: InvoiceCalculatorTaxInput[],
    line_is_inclusive: boolean,
  ): Prisma.Decimal {
    let inclusive_rate_sum = ZERO;
    let inclusive_fixed_tax = ZERO;
    let has_inclusive = false;

    for (const tax of taxes) {
      const is_inclusive = tax.is_inclusive ?? line_is_inclusive;
      if (!is_inclusive) continue;
      has_inclusive = true;

      const fraction = this.rateFraction(
        tax.tax_rate,
        this.resolveRateBasis(tax),
      );
      if (this.hasTaxableBase(tax.taxable_amount)) {
        // Misma base truncada que usará el bucle de impuestos, para que el
        // numerador del despeje y la cuota emitida no discrepen un centavo.
        const fixed_base = toDecimal(dianAmount(tax.taxable_amount));
        inclusive_fixed_tax = inclusive_fixed_tax.plus(
          toDecimal(dianAmount(fixed_base.times(fraction))),
        );
      } else {
        inclusive_rate_sum = inclusive_rate_sum.plus(fraction);
      }
    }

    const divisor = ONE.plus(inclusive_rate_sum);
    // Un divisor ≤ 0 solo puede venir de tarifas negativas, que el DTO prohíbe.
    // Si aun así llegara, se degrada a "sin despeje" en vez de emitir una base
    // negativa o infinita que envenenaría el CUFE en silencio.
    const base =
      !has_inclusive || divisor.lessThanOrEqualTo(ZERO)
        ? net_entered
        : net_entered.minus(inclusive_fixed_tax).dividedBy(divisor);

    // La base gravable nunca es negativa —un descuento mayor que el precio es
    // un error de captura, no una base a declarar— y el clamp cubre los DOS
    // caminos: una línea exclusiva sobredescontada tampoco puede declarar una
    // base en rojo.
    return base.isNegative() ? ZERO : base;
  }

  // --- Agregación ---

  /**
   * Agrupa los impuestos de todas las líneas en las filas de cabecera que se
   * persisten en `invoice_taxes`, una por
   * `(nombre, tarifa, tipo, inclusivo, esquema)`.
   *
   * Se suman valores YA truncados, así que la cabecera es exactamente la suma
   * de lo que sale en el XML de cada línea.
   */
  private aggregateHeaderTaxes(lines: CalculatedLine[]): CalculatedTax[] {
    const buckets = new Map<string, CalculatedTax>();

    for (const line of lines) {
      for (const tax of line.taxes) {
        const key = [
          tax.tax_name,
          tax.tax_rate,
          tax.tax_type,
          tax.is_inclusive ? '1' : '0',
          tax.dian_tax_code,
        ].join('|');

        const existing = buckets.get(key);
        if (existing) {
          existing.taxable_amount = dianSum([
            existing.taxable_amount,
            tax.taxable_amount,
          ]);
          existing.tax_amount = dianSum([existing.tax_amount, tax.tax_amount]);
          continue;
        }
        buckets.set(key, { ...tax });
      }
    }

    return Array.from(buckets.values());
  }

  /**
   * Agrupa por esquema DIAN. Es el desglose que alimenta `ValImp1/2/3` del CUFE
   * y los `cac:TaxSubtotal` del documento, así que se resuelve con la MISMA
   * función que el builder UBL (`resolveTaxCodeFromTax`). Dos clasificaciones
   * paralelas ya causaron un defecto P0 en este dominio.
   */
  private aggregateTaxSchemes(taxes: CalculatedTax[]): CalculatedTaxScheme[] {
    const buckets = new Map<string, CalculatedTaxScheme>();

    for (const tax of taxes) {
      const existing = buckets.get(tax.dian_tax_code);
      if (existing) {
        existing.taxable_amount = dianSum([
          existing.taxable_amount,
          tax.taxable_amount,
        ]);
        existing.tax_amount = dianSum([existing.tax_amount, tax.tax_amount]);
        continue;
      }
      buckets.set(tax.dian_tax_code, {
        dian_tax_code: tax.dian_tax_code,
        scheme_name: DIAN_TAX_NAMES[tax.dian_tax_code] || tax.dian_tax_code,
        taxable_amount: tax.taxable_amount,
        tax_amount: tax.tax_amount,
      });
    }

    // Orden estable 01 → 04 → 03 → resto, el mismo del hash CUFE, para que un
    // consumidor pueda leer por posición sin reordenar.
    return Array.from(buckets.values()).sort((a, b) => {
      const rank_a = CUFE_SCHEME_ORDER.indexOf(a.dian_tax_code);
      const rank_b = CUFE_SCHEME_ORDER.indexOf(b.dian_tax_code);
      return (
        (rank_a === -1 ? CUFE_SCHEME_ORDER.length : rank_a) -
        (rank_b === -1 ? CUFE_SCHEME_ORDER.length : rank_b)
      );
    });
  }

  private schemeTotal(schemes: CalculatedTaxScheme[], code: string): string {
    return dianSum(
      schemes
        .filter((scheme) => scheme.dian_tax_code === code)
        .map((scheme) => scheme.tax_amount),
    );
  }

  // --- Retenciones ---

  /**
   * Calcula el importe de cada retención. NO decide si aplica —eso es
   * `WithholdingResolverService`— y NO la resta de ningún total.
   *
   * Base por defecto: `reteiva` retiene sobre el IVA de la operación, no sobre
   * el subtotal; `retefuente` y `reteica` sobre la base gravable. Un `base`
   * explícito siempre gana.
   */
  private calculateWithholdings(
    withholdings: InvoiceCalculatorWithholdingInput[],
    total_before_tax: string,
    tax_iva: string,
    divergences: InvoiceCalculatorDivergence[],
  ): CalculatedWithholding[] {
    return withholdings.map((withholding) => {
      const type = this.normalizeTaxType(withholding.withholding_type);
      const rate_basis =
        withholding.rate_basis ?? (type === 'reteica' ? 'per_mil' : 'percent');
      const default_base = type === 'reteiva' ? tax_iva : total_before_tax;
      const base = this.hasValue(withholding.base)
        ? dianAmount(withholding.base)
        : default_base;
      const amount = dianAmount(
        toDecimal(base).times(this.rateFraction(withholding.rate, rate_basis)),
      );

      if (this.hasValue(withholding.amount)) {
        const received = dianAmount(withholding.amount);
        const difference = toDecimal(received).minus(toDecimal(amount));
        if (difference.abs().greaterThan(ONE_CENT)) {
          divergences.push({
            scope: 'withholding_amount',
            line_index: -1,
            tax_type: type,
            tax_name: withholding.concept_code,
            expected: amount,
            received,
            difference: dianAmount(difference),
          });
        }
      }

      return {
        withholding_type: type,
        concept_code: withholding.concept_code,
        rate: dianRate(withholding.rate),
        rate_basis,
        base,
        amount,
      };
    });
  }

  // --- Helpers ---

  /**
   * Compara lo recalculado contra lo que afirmó el cliente y registra la
   * divergencia cuando supera un centavo.
   *
   * Un centavo de tolerancia porque el cliente puede redondear donde el Anexo
   * manda truncar, y esa diferencia es ruido, no un error de captura. Cualquier
   * cosa mayor —el `tax_amount: 0` que manda el formulario, por ejemplo— sí es
   * señal.
   */
  private reportTaxDivergence(
    divergences: InvoiceCalculatorDivergence[],
    line_index: number,
    line_description: string | undefined,
    tax: InvoiceCalculatorTaxInput,
    computed: string,
  ): void {
    if (!this.hasValue(tax.tax_amount)) return;

    const received = dianAmount(tax.tax_amount);
    const difference = toDecimal(received).minus(toDecimal(computed));
    if (!difference.abs().greaterThan(ONE_CENT)) return;

    divergences.push({
      scope: 'line_tax',
      line_index,
      line_description,
      tax_name: tax.tax_name,
      tax_type: this.normalizeTaxType(tax.tax_type),
      expected: computed,
      received,
      difference: dianAmount(difference),
    });
  }

  /**
   * Esquema DIAN del impuesto. Delega en `UblCommonBuilder.resolveTaxCodeFromTax`
   * —la ÚNICA clasificación del dominio— construyendo el `ProviderInvoiceTax`
   * mínimo que esa función lee (`tax_type` y, como caída, `tax_name`). Los
   * importes van en cero porque no participan de la clasificación.
   */
  private resolveDianTaxCode(tax: InvoiceCalculatorTaxInput): string {
    const probe: ProviderInvoiceTax = {
      tax_name: tax.tax_name,
      tax_type: this.normalizeTaxType(tax.tax_type),
      tax_rate: dianRate(tax.tax_rate),
      taxable_amount: dianAmount(0),
      tax_amount: dianAmount(0),
    };
    return UblCommonBuilder.resolveTaxCodeFromTax(probe);
  }

  /**
   * Unidad de la tarifa. Explícita si el llamador la declara; si no, ICA (y su
   * retención) van por mil y todo lo demás en porcentaje. La regla se deriva
   * del esquema DIAN resuelto, no de una segunda tabla de nombres.
   */
  private resolveRateBasis(
    tax: InvoiceCalculatorTaxInput,
  ): InvoiceTaxRateBasis {
    if (tax.rate_basis) return tax.rate_basis;
    // Los DOS códigos, no sólo el '03'. Cuando `resolveTaxCodeFromTax` todavía
    // clasificaba un «ReteICA» como ICA por su nombre, este `=== ICA` cubría de
    // rebote a la retención. Al endurecer esa clasificación —un reteica ahora
    // resuelve a su propio esquema '07', que es lo que impide que contamine el
    // `ValImp3` del CUFE— la retención habría caído a `percent` y una tarifa de
    // 9,66 ‰ se habría cobrado como 9,66 %: diez veces la retención debida.
    const code = this.resolveDianTaxCode(tax);
    return code === DIAN_TAX_CODES.ICA || code === DIAN_TAX_CODES.RETE_ICA
      ? 'per_mil'
      : 'percent';
  }

  /** Tarifa → fracción. 19 % ⇒ 0,19 · 7 ‰ ⇒ 0,007. Siempre en `Decimal`. */
  private rateFraction(
    rate: DianNumericInput,
    basis: InvoiceTaxRateBasis,
  ): Prisma.Decimal {
    return toDecimal(rate).dividedBy(
      basis === 'per_mil' ? PER_MIL_DIVISOR : PERCENT_DIVISOR,
    );
  }

  /**
   * Divisor de la *price unit*, con el mismo saneo que `dian-money.util.ts`:
   * solo un valor > 1 cuenta como escala. Se replica acá únicamente para el
   * `gross_amount` informativo; el importe legal sigue saliendo de
   * `dianLineExtension`.
   */
  private priceUnitDivisor(value: DianNumericInput): Prisma.Decimal {
    const parsed = toDecimal(value);
    return parsed.greaterThan(ONE) ? parsed : ONE;
  }

  /** `iva` es el default de todo el dominio: una fila sin tipo ES IVA. */
  private normalizeTaxType(tax_type: string | null | undefined): string {
    return (tax_type ?? '').trim().toLowerCase() || 'iva';
  }

  /**
   * ¿El cliente declaró este campo? Distinto de "vale cero": un `tax_amount: 0`
   * declarado es precisamente la afirmación que hay que contrastar.
   */
  private hasValue(value: DianNumericInput): boolean {
    return value !== null && value !== undefined && value !== '';
  }

  /**
   * ¿El impuesto trae una BASE PROPIA que respetar?
   *
   * No es `hasValue`, y la diferencia es la factura entera. El formulario del
   * panel manda `taxable_amount: 0` como marcador de posición —igual que manda
   * `tax_amount: 0`— esperando que el servidor calcule; leído como una base
   * declarada, ese cero produce dos daños a la vez: la cuota sale cero (0 × 19 %)
   * y el despeje del precio impuesto-incluido no ocurre, porque una base fija
   * no entra al divisor. Una línea de $119.000 IVA incluido se persistía con
   * base 119.000 y cuota 0 sin que nada fallara.
   *
   * Cero no se pierde como afirmación: una base legítimamente nula sólo ocurre
   * en una línea de importe nulo, y ahí la base de la línea también es cero, de
   * modo que caer a ella da el mismo resultado. Lo que se descarta es
   * únicamente el marcador de posición.
   */
  private hasTaxableBase(value: DianNumericInput): boolean {
    return this.hasValue(value) && !toDecimal(value).isZero();
  }
}
