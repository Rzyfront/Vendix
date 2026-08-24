/**
 * Forma del snapshot de configuración de un perfil de facturación.
 *
 * ## Qué es este archivo y qué NO es
 *
 * Es el contrato de `invoice_profile_versions.config`, la columna JSON que una
 * factura timbrada congela por `(profile_id, profile_version)`. No es una
 * preferencia de interfaz: es **la configuración con la que se calculó un
 * documento fiscal**, y por eso su forma se versiona y se valida.
 *
 * Un campo que falte aquí obliga a la emisión a leer configuración VIVA, que es
 * el defecto que el snapshot existe para cerrar: entre la captura y la
 * transmisión pueden pasar días, y en el intervalo la tienda pudo cambiar el
 * régimen. Un documento construido con la configuración de hoy y los importes de
 * la semana pasada declara una gravabilidad que contradice sus propios números.
 *
 * ## Por qué es agnóstico del runtime
 *
 * Este archivo NO importa Prisma, Nest ni Angular, y sus decimales son
 * `string`. Dos razones:
 *
 * 1. El editor del frontend tiene que validar los mismos porcentajes que el
 *    backend rechaza. Si la validación viviera sólo en el backend, el frontend
 *    la duplicaría y las dos copias divergirían — que es literalmente el bug que
 *    originó la unificación de la política de contraseñas
 *    (`common/validators/password-policy.ts` y su spec de paridad).
 * 2. `libs/shared-types` sólo publica declaraciones y no tiene mapeo de rutas en
 *    ningún `tsconfig`, así que no hay paquete compartido EJECUTABLE entre Nest
 *    y Angular. El patrón del repo es espejo + spec de paridad, no import.
 *
 * ## Por qué los porcentajes son `string` y no `number`
 *
 * Porque tienen que sumar **exactamente** 100. Un `number` mete error binario en
 * la suma: `33.33 + 33.33 + 33.34` no da `100` en punto flotante IEEE-754. El
 * parseo de abajo convierte a entero escalado (centésimas) y compara enteros, lo
 * que es exacto y no depende de ninguna librería de decimales.
 */

// ─── Constantes fiscales ──────────────────────────────────────────────────

/**
 * Versión de la FORMA de este objeto, no del perfil.
 *
 * `invoice_profile_versions.version` cuenta las ediciones del usuario; esto
 * cuenta los cambios de esquema del snapshot. Sin este número, migrar la forma
 * dejaría snapshots viejos indistinguibles de snapshots nuevos incompletos, y
 * una factura de hace un año no se podría reproducir.
 */
export const INVOICE_PROFILE_CONFIG_VERSION = 1;

/**
 * Piso legal del AIU en centésimas: 10,00 % del valor del contrato
 * (E.T. art. 462-1).
 *
 * Se duplica el número que `DEFAULT_AIU_MINIMUM_PERCENT` ya declara como
 * `Prisma.Decimal` en `services/invoice-calculator.service.ts:88`, porque ese
 * archivo importa Prisma y este no puede. La divergencia la impide un test, no
 * la buena voluntad: ver `invoice-profile-config.contract.spec.ts`.
 */
export const AIU_LEGAL_FLOOR_PERCENT_SCALED = 1000;

/** Escala de los porcentajes: dos decimales, como los `cbc:Percent` del anexo. */
export const PERCENT_SCALE = 2;

/** 100,00 % en centésimas. */
export const PERCENT_TOTAL_SCALED = 10000;

// ─── Uniones ──────────────────────────────────────────────────────────────

/**
 * Régimen de IVA del contrato AIU. Espejo de `AiuVatRegime`
 * (`domains/store/settings/interfaces/store-settings.interface.ts:341`).
 *
 * · `et_462_1` — base gravable = A + I + U, con piso del 10 % del contrato.
 * · `decreto_1372_1992` — base gravable = **sólo la Utilidad**; administración e
 *   imprevistos quedan fuera del IVA, y no hay piso.
 */
export type AiuVatRegimeLiteral = 'et_462_1' | 'decreto_1372_1992';

/** Componentes del AIU. Espejo del enum de Prisma `aiu_component_enum`. */
export type AiuComponentLiteral = 'administracion' | 'imprevistos' | 'utilidad';

/**
 * Porción de costo reembolsable del contrato: entra siempre en el VALOR del
 * contrato —y por tanto mueve el piso legal—, pero si forma parte de la base
 * gravable depende de la base declarada. Bajo `'aiu'` y `'utilidad'` queda
 * FUERA, y eso es exactamente lo que distingue un contrato AIU de una venta
 * ordinaria. Bajo `'subtotal'` entra, porque esa base declina el tratamiento
 * AIU y grava el contrato completo.
 *
 * Este comentario decía «bajo ninguno de los dos regímenes», que era cierto
 * cuando había dos y dejó de serlo al añadirse la tercera base. La tabla que
 * manda es `AIU_TAXABLE_BUCKETS_BY_BASIS`; ninguna otra afirmación sobre qué
 * porción entra a la base debe escribirse aquí a mano.
 */
export type AiuBucket = AiuComponentLiteral | 'costo';

/**
 * Tipo de documento con que nace la factura (`invoice_type` del formulario de
 * emisión, traducido después a `fiscal_document_type` por `toFiscalDocumentType`).
 *
 * Vive en el perfil porque una empresa que exporta factura SIEMPRE al exterior:
 * dejarlo en «venta nacional» por omisión obliga a cambiarlo en cada documento,
 * y el día que alguien lo olvide sale una exportación declarada como venta
 * nacional. La lista es cerrada a propósito: un valor desconocido acá se
 * traduciría a un tipo de documento DIAN que no corresponde.
 */
export type ProfileDocumentType = 'sales_invoice' | 'export_invoice';

export const PROFILE_DOCUMENT_TYPES: readonly ProfileDocumentType[] = [
  'sales_invoice',
  'export_invoice',
];

/**
 * Lado de una retención.
 *
 * `practiced` = la tienda retiene al cliente. `suffered` = al cliente le
 * corresponde retener a la tienda. Son importes que van a asientos distintos y
 * a declaraciones distintas: confundirlos no produce un error de forma, produce
 * una declaración equivocada.
 */
export type WithholdingRole = 'practiced' | 'suffered';

export const WITHHOLDING_ROLES: readonly WithholdingRole[] = [
  'practiced',
  'suffered',
];

export const AIU_COMPONENTS: readonly AiuComponentLiteral[] = [
  'administracion',
  'imprevistos',
  'utilidad',
];

export const AIU_BUCKETS: readonly AiuBucket[] = [...AIU_COMPONENTS, 'costo'];

/**
 * Unidad en la que estan escritos los tres porcentajes de `aiu.components`.
 *
 * ## Por que hay que decirlo y no se puede deducir
 *
 * `'5.00' / '2.00' / '3.00'` y `'50.00' / '20.00' / '30.00'` describen el MISMO
 * contrato —un AIU del 10 % repartido mitad administracion, un quinto
 * imprevistos, tres decimos utilidad— pero significan cosas distintas si no se
 * dice respecto a que se miden. La suma no basta para distinguirlos: un AIU del
 * 100 % del contrato (todo es utilidad, sin costo reembolsable) es legitimo, asi
 * que `100.00` es una suma valida en las dos unidades.
 *
 * · `'contract'` — porcentajes **del valor del contrato**. Es como se redacta un
 *   contrato AIU («AIU del 10 %: A 5 %, I 2 %, U 3 %») y es la unica unidad en
 *   la que el piso legal se puede verificar AL CONFIGURAR: la suma ES el AIU
 *   como porcentaje del contrato, asi que se compara contra el 10 % del art.
 *   462-1 antes de que exista una factura, no despues de gastar el consecutivo.
 * · `'aiu'` — porcentajes **del AIU**, sumando 100. Es lo que guardaron los
 *   perfiles anteriores a este campo.
 *
 * La ausencia significa `'aiu'` y no `'contract'` a proposito: los snapshots ya
 * timbrados son inmutables y se escribieron con esa unidad. Leerlos como
 * `'contract'` convertiria un AIU del 100 % —correcto— en un reparto absurdo, y
 * peor: un `85.00` de utilidad pasaria de «85 % del AIU» a «85 % del contrato»,
 * multiplicando por diez la base gravable de un documento ya emitido.
 */
export type AiuComponentsBasis = 'contract' | 'aiu';

export const AIU_COMPONENTS_BASES: readonly AiuComponentsBasis[] = [
  'contract',
  'aiu',
];

/**
 * Unidad efectiva de `aiu.components`. Ausente o nula ⇒ `'aiu'` (heredado).
 *
 * Un valor desconocido tambien devuelve `'aiu'`, la unidad conservadora, y el
 * validador lo reporta aparte: si devolviera `'contract'`, un snapshot con la
 * unidad corrupta se leeria con la base gravable inflada diez veces.
 */
export function resolveAiuComponentsBasis(
  aiu: Pick<ProfileAiuConfig, 'components_basis'> | null | undefined,
): AiuComponentsBasis {
  return aiu?.components_basis === 'contract' ? 'contract' : 'aiu';
}

/**
 * Componentes cuya suma ENTRA en la base gravable, por régimen.
 *
 * Es la tabla que decide si la matriz de impuestos del perfil se contradice con
 * su propio régimen. La contradicción es el fallo que este plan entero existe
 * para cortar: el régimen decide qué línea emite `cac:TaxTotal` y los importes
 * salen de los tributos persistidos, así que si las dos mitades salen de
 * regímenes distintos el XML declara una gravabilidad que contradice sus propios
 * números → rechazo FAU04 con el consecutivo ya quemado.
 */
export const AIU_TAXABLE_COMPONENTS_BY_REGIME: Readonly<
  Record<AiuVatRegimeLiteral, readonly AiuComponentLiteral[]>
> = {
  et_462_1: ['administracion', 'imprevistos', 'utilidad'],
  decreto_1372_1992: ['utilidad'],
};

/**
 * Base gravable declarada del contrato AIU: qué porción entra en el IVA.
 *
 * · `'aiu'` — el A+I+U completo, con piso legal. Espejo de `regime: 'et_462_1'`.
 * · `'utilidad'` — sólo la Utilidad, sin piso. Espejo de `regime: 'decreto_1372_1992'`.
 * · `'subtotal'` — se declina el tratamiento AIU: el IVA grava el valor TOTAL
 *   del contrato, costo reembolsable incluido, sin piso —porque no hay AIU que
 *   pisar—. Es una tercera opción legítima que hoy no tiene representación: la
 *   matriz de 4 casillas nunca pudo declarar «grava todo, sin desglose AIU».
 *
 * Reemplaza a los 2 regímenes como la pregunta que la UI le hace al operador
 * —qué grabar, no qué régimen citar—, pero `regime` sigue existiendo y
 * persistiéndose para quien ya lo lee (ver {@link regimeFromTaxableBasis}).
 */
export type AiuTaxableBasis = 'aiu' | 'utilidad' | 'subtotal';

export const AIU_TAXABLE_BASES: readonly AiuTaxableBasis[] = [
  'aiu',
  'utilidad',
  'subtotal',
];

/**
 * `taxable_basis` → `regime` equivalente. `'subtotal'` no tiene régimen legal
 * —es la ausencia de tratamiento AIU—, así que devuelve `null`.
 *
 * Inversa de {@link taxableBasisFromRegime} para los dos valores que sí tienen
 * ida y vuelta: `regimeFromTaxableBasis(taxableBasisFromRegime(r)) === r`.
 */
export function regimeFromTaxableBasis(
  basis: AiuTaxableBasis,
): AiuVatRegimeLiteral | null {
  switch (basis) {
    case 'aiu':
      return 'et_462_1';
    case 'utilidad':
      return 'decreto_1372_1992';
    case 'subtotal':
      return null;
  }
}

/**
 * `regime` → `taxable_basis` equivalente. Existe para leer snapshots viejos
 * —de antes de este campo— sin reescribirlos: `taxable_basis` ausente se
 * deriva de `regime`, nunca al revés.
 *
 * El ternario pregunta por `decreto_1372_1992`, NO por `et_462_1`, y eso es
 * deliberado: la rama por defecto tiene que caer en la base MÁS AMPLIA. Un
 * `regime` corrupto o de una versión futura debe declarar de más (recuperable
 * con nota crédito) y nunca de menos (sanción e intereses ante la DIAN).
 * Escrito al revés, `regime: 'et_999'` gravaría sólo la utilidad. No lo
 * inviertas.
 */
export function taxableBasisFromRegime(
  regime: AiuVatRegimeLiteral,
): AiuTaxableBasis {
  return regime === 'decreto_1372_1992' ? 'utilidad' : 'aiu';
}

/**
 * Base gravable efectiva de una config AIU: `taxable_basis` si está presente
 * y es válida, si no la derivada de `regime`. Es el único punto de lectura:
 * todo lo demás en este archivo (y en `InvoiceCalculatorService`,
 * `InvoicingService`, `InvoiceFlowService`) debe pasar por aquí en vez de leer
 * `regime` a secas, o la introducción de `'subtotal'` no los alcanza.
 */
export function resolveAiuTaxableBasis(
  aiu: Pick<ProfileAiuConfig, 'regime' | 'taxable_basis'> | null | undefined,
): AiuTaxableBasis {
  if (aiu?.taxable_basis && AIU_TAXABLE_BASES.includes(aiu.taxable_basis)) {
    return aiu.taxable_basis;
  }
  return taxableBasisFromRegime(aiu?.regime ?? 'et_462_1');
}

/**
 * Buckets cuya suma ENTRA en la base gravable, por base declarada.
 *
 * Generaliza a {@link AIU_TAXABLE_COMPONENTS_BY_REGIME} sumando `'subtotal'` y
 * el bucket `'costo'`: bajo `'subtotal'` los CUATRO buckets —incluido el costo
 * reembolsable— entran a la base, porque no hay tratamiento AIU que los
 * excluya.
 */
export const AIU_TAXABLE_BUCKETS_BY_BASIS: Readonly<
  Record<AiuTaxableBasis, readonly AiuBucket[]>
> = {
  aiu: ['administracion', 'imprevistos', 'utilidad'],
  utilidad: ['utilidad'],
  subtotal: ['administracion', 'imprevistos', 'utilidad', 'costo'],
};

// ─── Modelo de contabilización del AIU ────────────────────────────────────

/**
 * Cómo entra el AIU al documento. **No es preferencia de presentación: cambia
 * la forma del XML y, por lo tanto, los totales que la DIAN valida.**
 *
 * · `'sumada'` — Administración, Imprevistos y Utilidad son LÍNEAS del
 *   documento. El valor del contrato es su suma y la base gravable la componen
 *   sólo las líneas que la base declarada grava. Es lo que el calculador hace
 *   hoy **por construcción**, así que un snapshot sin este campo se sigue
 *   emitiendo exactamente igual.
 * · `'no_sumada'` — el AIU deja de ser línea y pasa a ser sólo base de
 *   impuestos: una línea por el valor del contrato con una base gravable MENOR
 *   que su propio importe. Requiere el `taxable_amount` por línea que ADR-7
 *   introduce y el visto bueno de `dian-totals.validator` sobre los dos
 *   modelos.
 *
 * Ver {@link ENABLED_ACCOUNTING_MODELS}: hoy sólo uno de los dos se puede
 * escribir, y ese es el interruptor único que lo decide.
 */
export type AccountingModel = 'sumada' | 'no_sumada';

/** Los dos modelos que el tipo admite. Forma, no habilitación. */
export const ACCOUNTING_MODELS: readonly AccountingModel[] = [
  'sumada',
  'no_sumada',
];

/**
 * Los modelos que HOY se pueden persistir y emitir. **Interruptor único.**
 *
 * `'no_sumada'` está fuera a propósito: ofrecerlo antes de que el armado del
 * XML esté verificado produce documentos cuyos totales monetarios (FAU02,
 * FAU04, FAU06) no cuadran, y la DIAN los rechaza **al firmar** — o sea, con el
 * consecutivo ya tomado y sin forma de que el operador sepa por qué.
 *
 * Añadir `'no_sumada'` a esta lista es el paso D.7 del plan y es lo ÚNICO que
 * hace falta tocar para habilitarlo: la compuerta del perfil
 * ({@link validateInvoiceProfileConfig} vía `AIU_ACCOUNTING_MODEL_NOT_ENABLED`),
 * la del payload del documento (`CreateInvoiceDto.aiu_accounting_model`) y el
 * motivo que la pantalla pinta ({@link accountingModelDisabledReason}) leen
 * todas de acá. Dos listas habrían dejado la UI ofreciendo lo que la escritura
 * rechaza, o al revés.
 */
export const ENABLED_ACCOUNTING_MODELS: readonly AccountingModel[] = ['sumada'];

/** `true` si el modelo se puede escribir hoy. */
export function isAccountingModelEnabled(value: unknown): boolean {
  return ENABLED_ACCOUNTING_MODELS.includes(value as AccountingModel);
}

/**
 * Modelo efectivo de una config AIU. **La ausencia significa `'sumada'`**, que
 * es lo que el calculador ya hace: un perfil guardado antes de que este campo
 * existiera no cambia de comportamiento al leerse, y no hay que reescribir
 * ningún snapshot —que además son inmutables a propósito—.
 *
 * Único punto de lectura, igual que {@link resolveAiuTaxableBasis}: leer
 * `aiu.accounting_model` a secas en otro sitio haría que el día que se habilite
 * `'no_sumada'` un consumidor viera `undefined` donde el resto ve `'sumada'`.
 */
export function resolveAccountingModel(
  aiu: Pick<ProfileAiuConfig, 'accounting_model'> | null | undefined,
): AccountingModel {
  const value = aiu?.accounting_model;
  if (value && ACCOUNTING_MODELS.includes(value)) return value;
  return 'sumada';
}

/**
 * Por qué un modelo no se puede elegir todavía, en español y **fechado**.
 *
 * Vive acá y no en el template porque las DOS pantallas que capturan la sección
 * AIU tienen que decir lo mismo, y porque una insignia «NO DISPONIBLE» sin
 * motivo ni fecha es exactamente el P1 que este texto cierra. `null` cuando el
 * modelo sí está habilitado.
 */
export function accountingModelDisabledReason(
  model: AccountingModel,
): string | null {
  if (isAccountingModelEnabled(model)) return null;
  return 'Cambia los totales monetarios del XML (FAU02, FAU04, FAU06). Se habilita en la Fase D del plan de facturación, cuando el armado del documento pase la compuerta de totales en los dos modelos; hasta entonces elegirlo produciría facturas rechazadas al firmar, con el consecutivo ya tomado.';
}

// ─── Las 7 secciones del editor ───────────────────────────────────────────

/**
 * Sección 1 — Datos generales.
 *
 * NO repite `name`, `operation_type`, `state` ni `is_default`: esos son COLUMNAS
 * de `invoice_profiles`. Duplicarlos dentro del JSON crearía dos fuentes de
 * verdad que pueden divergir, y la de la columna es la que los índices y el
 * único-predeterminado-por-tipo hacen cumplir. Aquí va sólo lo que no es
 * columna.
 */
export interface ProfileGeneralConfig {
  /** Descripción libre para el operador. No viaja al XML. */
  description?: string | null;
  /** Nota interna: por qué existe este perfil. Auditoría humana. */
  internal_note?: string | null;
}

/**
 * Sección 2 — AIU.
 *
 * `null` cuando el perfil no es de operación `'09'`. No es opcional por
 * comodidad: un perfil estándar con una sección AIU a medias es un perfil que
 * podría emitir un documento AIU sin darse cuenta.
 */
export interface ProfileAiuConfig {
  regime: AiuVatRegimeLiteral;
  /**
   * Base gravable declarada. Ver {@link AiuTaxableBasis}: reemplaza a `regime`
   * como la pregunta que hace la UI, pero es OPCIONAL a propósito —un snapshot
   * de antes de este campo no lo tiene, y se lee con
   * {@link resolveAiuTaxableBasis} sin reescribir nada—. Ausente o nulo ⇒ se
   * deriva de `regime`.
   */
  taxable_basis?: AiuTaxableBasis | null;
  /**
   * Objeto del contrato por omisión, que se concatena al prefijo obligatorio en
   * el `cbc:Note` de la línea de Administración (regla CAV03). La factura puede
   * pisarlo con el suyo; el perfil sólo aporta el valor por omisión.
   */
  contract_object: string;
  /**
   * Aplica el piso legal. **Explícitamente booleano, nunca `undefined`.**
   *
   * En `store_settings.invoicing.aiu` la ausencia significa «activo», y esa
   * ambigüedad ya obligó a escribir `settings.enforce_minimum_base === false`
   * en la emisión para no leer el NULL como «sin piso». Un snapshot no puede
   * heredar esa trampa: aquí el valor está siempre presente.
   */
  enforce_minimum_base: boolean;
  /** Porcentaje del piso, como decimal en cadena. `'10.00'` es el legal. */
  minimum_base_percent: string;
  /**
   * Unidad de los tres porcentajes de abajo. Ausente ⇒ `'aiu'`.
   * Ver {@link AiuComponentsBasis}: no es preferencia de interfaz, cambia lo que
   * los mismos tres numeros significan.
   */
  components_basis?: AiuComponentsBasis | null;
  /**
   * Reparto por omisión del AIU, en la unidad que declara `components_basis`.
   *
   * · `'contract'` — porcentajes del valor del contrato; su SUMA es el AIU, y lo
   *   que falte hasta el 100 % es costo reembolsable.
   * · `'aiu'` — porcentajes del AIU; suman exactamente `'100.00'` y el costo
   *   reembolsable queda fuera de este reparto.
   */
  components: Readonly<Record<AiuComponentLiteral, string>>;
  /**
   * Cómo entra el AIU al documento. Ver {@link AccountingModel}: OPCIONAL a
   * propósito, porque **ausente significa `'sumada'`** —lo que el calculador ya
   * hace por construcción— y así un snapshot anterior a este campo se emite sin
   * cambio de comportamiento. Se lee con {@link resolveAccountingModel}.
   */
  accounting_model?: AccountingModel | null;
}

/**
 * Sección 3 — Cuentas PUC.
 *
 * Códigos de cuenta como cadenas, no ids: el plan de cuentas es por tenant y un
 * id no significa nada fuera de él. Que la cuenta EXISTA no se puede validar en
 * este archivo —haría falta el plan de cuentas del tenant— así que se valida al
 * usarla, contra `chart_of_accounts`. Aquí sólo se valida la forma.
 */
export interface ProfileAccountingConfig {
  /** Cuenta de ingreso por componente. */
  revenue_account_by_bucket?: Partial<Record<AiuBucket, string>> | null;
  /** IVA generado (típicamente 240802 en el PUC colombiano). */
  vat_payable_account?: string | null;
  /** Sobrescrituras de `mapping_key` → código de cuenta. */
  mapping_key_overrides?: Readonly<Record<string, string>> | null;
}

/**
 * Una regla de la matriz de gravabilidad.
 *
 * **Es la razón de ser de la feature.** `InvoiceCalculatorService` sabe QUÉ
 * componentes son gravables —lo deriva del régimen— pero no A QUÉ TARIFA: la
 * tarifa depende del bien o servicio y no hay catálogo del que deducirla. Por
 * eso no podía imponer el impuesto de una línea gravable que llegara sin
 * declarar, y por eso una factura podía nacer sub-declarada. Esta regla es la
 * tarifa que faltaba.
 */
export interface ProfileTaxRule {
  bucket: AiuBucket;
  /** Si esta porción entra en la base gravable del documento. */
  taxable: boolean;
  /**
   * Código de tributo de la tabla 13.2.2 del anexo (`cac:TaxScheme/cbc:ID`).
   * `'01'` IVA, `'04'` INC, etc. Ver `DIAN_TAX_CODES`.
   */
  tax_code: string;
  /**
   * Tarifa para `cac:TaxCategory/cbc:Percent`, como decimal en cadena.
   *
   * `'0.00'` con `taxable: true` es LEGÍTIMO y distinto de no declarar: un
   * servicio exento declara su grupo con `Percent` en cero. Confundir los dos
   * casos bloquearía facturas correctas.
   */
  rate: string;
}

/** Sección 4 — Base de impuestos. */
export interface ProfileTaxConfig {
  rules: readonly ProfileTaxRule[];
}

/** Sección 5 — Líneas modelo. */
export interface ProfileModelLine {
  bucket: AiuBucket;
  description: string;
  /** Código de unidad UBL (`cbc:InvoicedQuantity/@unitCode`), p. ej. `'94'`. */
  unit_code?: string | null;
  /** Cantidad por omisión, decimal en cadena. */
  quantity?: string | null;
  /**
   * Precio unitario por omisión, decimal en cadena.
   *
   * ## Por qué es cadena y no número
   *
   * El snapshot es `jsonb` y un `number` de JavaScript no representa exactamente
   * `0.1`: guardar el precio como número lo redondearía al escribirlo y otra vez
   * al leerlo, y un precio que cambia solo entre guardar y precargar es
   * indistinguible de un precio mal teclado. La cadena viaja tal cual y quien la
   * consume decide la escala.
   *
   * Hasta SEIS decimales, que es lo que el anexo admite en el precio unitario
   * (`cbc:PriceAmount`), aunque los totales se declaren con dos. `null` = el
   * precio se teclea en cada factura, que es lo correcto cuando cambia por mes.
   */
  unit_price?: string | null;
}

/** Sección 6 — Formato de impresión y presentación. */
export interface ProfileFormatConfig {
  /**
   * Plantilla del Hub de formatos de impresion (`print_templates.id`).
   *
   * ## Por que un id y no la `template_key`
   *
   * `template_key` apunta a `default_templates`, que es el catalogo VIEJO de
   * plantillas por clave de texto: nadie valida que la clave exista, asi que un
   * error de tipeo se guarda sin queja y se descubre el dia que alguien imprime.
   * El Hub —`print_templates` + `store_print_format_configs`— es el que la
   * tienda edita hoy, y sus plantillas tienen id, `format_type` y dueno
   * (`organization_id` / `is_system`), o sea que la referencia SI se puede
   * verificar contra algo.
   *
   * `null` significa «la plantilla activa de la tienda para
   * `fiscal_electronic_invoice`». Eso es lo correcto por omision: un perfil que
   * no opina sobre el diseno no debe congelar uno.
   *
   * `template_key` se conserva y no se borra porque hay perfiles guardados que
   * la traen. Cuando ambas vienen, manda `template_id`: es la unica de las dos
   * que el motor de impresion sabe resolver.
   */
  template_id?: number | null;
  /** Clave de plantilla de `default_templates`. Legado; ver `template_id`. */
  template_key?: string | null;
  /** Imprimir el desglose A/I/U en el documento humano. */
  show_aiu_breakdown: boolean;
  /** Decimales mostrados al operador. No afecta al XML. */
  display_decimals: number;
}

/**
 * Sección 7 — Metadata DIAN.
 *
 * `customization_id` NO se repite: es `invoice_profiles.operation_type`, que ya
 * es columna. Aquí va lo que la acompaña.
 */
export interface ProfileDianConfig {
  /**
   * Tipo de documento con que nace la factura. Ausente = venta nacional, que
   * es el caso de la inmensa mayoría y el valor que el formulario ya trae.
   */
  document_type?: ProfileDocumentType | null;
  /** Medio de pago por omisión (`cbc:PaymentMeansCode`). */
  payment_means_code?: string | null;
  /** Método de pago por omisión (`cbc:PaymentMeansID`). */
  payment_method_code?: string | null;
  /** Notas fijas que se anexan al documento (`cbc:Note` de cabecera). */
  header_notes?: readonly string[] | null;
  /**
   * Resolución de numeración PREFERIDA (`invoicing_resolutions.id`).
   *
   * Es una PREFERENCIA, no una autoridad. La numeración autorizada vence, se
   * agota y se reemplaza, así que un id guardado en un snapshot inmutable
   * envejece por diseño: la resolución que hoy numera puede estar vencida
   * cuando alguien use el perfil el mes entrante. Quien precarga tiene que
   * comprobarla contra las vigentes con consecutivo disponible y, si ya no
   * sirve, caer en el criterio automático DICIÉNDOLO — nunca obedecerla a
   * ciegas ni fallar en silencio.
   *
   * Para qué sirve entonces: una tienda con varios rangos autorizados vivos a
   * la vez (una sede, un proyecto, un punto de venta por rango) necesita decir
   * cuál le toca a cada perfil. Sin este campo el operador tiene que elegirlo a
   * mano en cada factura, que es justo lo que el perfil existe para evitar.
   *
   * Igual que `format.template_id`, es una FK LÓGICA: acá sólo se exige la
   * forma. Rechazar el perfil porque la resolución se venció volvería
   * inguardable un perfil por completo correcto en todo lo demás.
   */
  resolution_id?: number | null;
  /**
   * Número de la resolución preferida, tal como estaba al guardar el perfil.
   *
   * Redundante a propósito. Sin él, una preferencia que ya no puede numerar es
   * un id huérfano y el aviso no puede decir a QUÉ resolución apuntaba el
   * perfil: el operador vería «la preferencia del perfil no sirve» sin poder
   * relacionarlo con el papel que tiene en la mano.
   */
  resolution_number?: string | null;
}

/**
 * Sección 8 — una retención preconfigurada.
 *
 * ## Por qué NO lleva base
 *
 * La base de una retención es el importe de la factura concreta, y el backend
 * la recalcula al emitir. Guardarla en el perfil crearía un segundo número que
 * dice cuál era la base —el del perfil, escrito hace meses— y el día que los dos
 * discrepen nadie sabría cuál manda. Lo que el perfil aporta es lo que de
 * verdad se olvida: QUÉ concepto aplica, de qué lado, y a qué tarifa.
 */
export interface ProfileWithholdingRule {
  /**
   * `withholding_concepts.id`. FK LÓGICA, igual que `format.template_id`: acá
   * sólo se exige la forma. Que el concepto exista y sea de la tienda lo
   * comprueba quien precarga, contra el catálogo vivo.
   */
  concept_id: number;
  role: WithholdingRole;
  /**
   * Tarifa como PORCENTAJE decimal en cadena (`'2.50'` = 2,5 %).
   *
   * La misma escala que la matriz de impuestos, para que las dos secciones se
   * lean igual. La conversión a fracción —que es lo que el backend recibe— la
   * hace quien precarga, en un solo sitio.
   */
  rate: string;
}

/** Sección 8 — Retenciones por omisión. */
export interface ProfileWithholdingConfig {
  rules: readonly ProfileWithholdingRule[];
}

/**
 * Sección 9 — Divisa.
 *
 * ## Por qué se guarda la divisa y NO la tasa
 *
 * La factura se emite SIEMPRE en pesos colombianos (Res. DIAN 000042/2020,
 * art. 73): la divisa extranjera sólo declara la conversión en
 * `cac:PaymentAlternativeExchangeRate` y no cambia el importe exigible. La TASA,
 * en cambio, es del día de la operación. Guardarla en el perfil sería declarar
 * el cambio de la fecha en que alguien configuró el perfil —un dato que parece
 * verificado y no lo está—, así que se consulta al emitir y punto.
 */
export interface ProfileCurrencyConfig {
  /**
   * Si las facturas de este perfil declaran conversión a divisa extranjera.
   *
   * Ausente o `false` = no. Es lo mismo para un snapshot viejo que no traía la
   * sección y para uno nuevo que dice que no la declara, y eso es correcto: las
   * dos cosas significan «esta factura no declara conversión».
   */
  declare_foreign?: boolean | null;
  /** Código ISO 4217 de tres letras (`cbc:TargetCurrencyCode`). */
  code?: string | null;
}

/**
 * El snapshot completo. Las 9 secciones, todas presentes.
 *
 * ## Por qué añadir secciones NO sube `config_version`
 *
 * La versión existe para que un snapshot viejo no se confunda con uno nuevo
 * INCOMPLETO. Acá no hay tal ambigüedad: un snapshot sin `withholdings` y uno
 * con `withholdings.rules: []` significan exactamente lo mismo —este perfil no
 * precarga retenciones—, igual que la ausencia de `currency` y
 * `declare_foreign: false`. Subir la versión sólo conseguiría que cada perfil
 * guardado antes de hoy se reportara «incompatible» hasta que alguien lo
 * reabriera, sin que ningún dato hubiera cambiado de significado.
 */
export interface InvoiceProfileConfig {
  config_version: number;
  general: ProfileGeneralConfig;
  /** `null` cuando el perfil no es de operación AIU (`'09'`). */
  aiu: ProfileAiuConfig | null;
  accounting: ProfileAccountingConfig;
  taxes: ProfileTaxConfig;
  model_lines: readonly ProfileModelLine[];
  format: ProfileFormatConfig;
  dian: ProfileDianConfig;
  withholdings: ProfileWithholdingConfig;
  currency: ProfileCurrencyConfig;
}

// ─── Aritmética exacta de porcentajes ─────────────────────────────────────

/**
 * `'19.00'` → `1900`. `null` si la cadena no es un porcentaje válido.
 *
 * Entero escalado a centésimas para que las sumas sean EXACTAS. Rechaza más de
 * dos decimales a propósito: el `cbc:Percent` del anexo lleva dos, y aceptar
 * `'33.333'` aquí sólo aplazaría el redondeo hasta el XML, donde ya nadie
 * relaciona el descuadre con el perfil que lo causó.
 */
export function parsePercentScaled(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const scaled = Number(whole) * 100 + Number(frac.padEnd(PERCENT_SCALE, '0'));
  return Number.isFinite(scaled) ? scaled : null;
}

/** `1900` → `'19.00'`. Inversa de `parsePercentScaled`. */
export function formatPercentScaled(scaled: number): string {
  const sign = scaled < 0 ? '-' : '';
  const abs = Math.abs(scaled);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ─── Validación pura ──────────────────────────────────────────────────────

/**
 * Un problema de la configuración, con el campo que lo causa.
 *
 * `field` es la ruta con puntos dentro del snapshot (`aiu.components.utilidad`)
 * para que el editor pueda marcar el control exacto en vez de mostrar un toast
 * genérico. `message` está en español porque se le muestra al operador.
 */
export interface ProfileConfigIssue {
  field: string;
  code: string;
  message: string;
}

/**
 * Problemas que NO impiden guardar el perfil.
 *
 * Sólo hay uno, y su razón es concreta. El objeto del contrato es un dato **por
 * factura** con valor por omisión en el perfil: `CreateInvoiceDto
 * .aiu_contract_object` lo declara opcional justo porque una empresa de
 * servicios tiene varios contratos AIU y describe uno distinto en cada
 * documento. Exigirlo al guardar el perfil no consigue que el dato sea correcto:
 * consigue que el usuario escriba relleno para poder guardar, y el relleno es
 * PEOR que el vacío — pasa la puerta de emisión y termina impreso como el objeto
 * del contrato en el `cbc:Note` de la línea de Administración, mientras que el
 * vacío falla ruidosamente antes de tomar consecutivo.
 *
 * O sea: el vacío se sigue reportando —el editor lo muestra como aviso y el
 * estado vacío puede pedirlo— pero no bloquea el guardado. Lo que bloquea la
 * EMISIÓN sigue siendo la puerta de la Fase A, que es donde el dato ya no puede
 * faltar.
 */
export const PROFILE_CONFIG_WARNING_CODES: readonly string[] = [
  'AIU_CONTRACT_OBJECT_EMPTY',
];

/**
 * `true` si el problema impide guardar. Es la única forma correcta de decidir si
 * una lista de problemas se traduce en un 422: `issues.length > 0` trataría un
 * aviso como un error.
 */
export function isBlockingIssue(issue: ProfileConfigIssue): boolean {
  return !PROFILE_CONFIG_WARNING_CODES.includes(issue.code);
}

/** Los problemas que bloquean, de una lista mixta. */
export function blockingIssues(
  issues: readonly ProfileConfigIssue[],
): ProfileConfigIssue[] {
  return issues.filter(isBlockingIssue);
}

/** Tarifas de IVA que la DIAN admite en `cbc:Percent` (tabla del anexo). */
const IVA_RATES_SCALED = new Set([0, 500, 1600, 1900]);
/** Tarifas de INC admitidas. */
const INC_RATES_SCALED = new Set([200, 400, 800, 1600]);

/**
 * Valida un snapshot de configuración. Devuelve **todos** los problemas, no el
 * primero: el editor tiene 7 secciones y devolver uno por vez obliga al usuario
 * a guardar siete veces para descubrir siete errores.
 *
 * Pura: no lanza, no lee base de datos, no depende del runtime. El backend la
 * envuelve y traduce el resultado a `INVOICING_PROFILE_005`; el frontend la usa
 * tal cual para marcar los campos en vivo.
 */
export function validateInvoiceProfileConfig(
  config: InvoiceProfileConfig,
  options: { operation_type: string },
): ProfileConfigIssue[] {
  const issues: ProfileConfigIssue[] = [];
  const isAiuOperation = options.operation_type === '09';

  if (config.config_version !== INVOICE_PROFILE_CONFIG_VERSION) {
    issues.push({
      field: 'config_version',
      code: 'CONFIG_VERSION_UNSUPPORTED',
      message: `La versión de configuración ${config.config_version} no es compatible con esta versión de Vendix (esperada: ${INVOICE_PROFILE_CONFIG_VERSION}).`,
    });
  }

  // ── Presencia de la sección AIU, atada al tipo de operación ──
  if (isAiuOperation && !config.aiu) {
    issues.push({
      field: 'aiu',
      code: 'AIU_SECTION_REQUIRED',
      message:
        'Un perfil de operación AIU (09) necesita su sección de AIU: sin régimen no se puede decidir qué parte del contrato lleva IVA.',
    });
  }
  if (!isAiuOperation && config.aiu) {
    issues.push({
      field: 'aiu',
      code: 'AIU_SECTION_NOT_APPLICABLE',
      message:
        'Este perfil no es de operación AIU (09), así que no puede llevar configuración de AIU. Cámbiale el tipo de operación o quita la sección.',
    });
  }

  if (config.aiu) {
    validateAiuSection(config.aiu, issues);
  }

  validateTaxSection(config, issues);
  validateModelLines(config, issues);
  validateFormat(config, issues);
  validateDianSection(config, issues);
  validateWithholdings(config, issues);
  validateCurrency(config, issues);
  validateBounds(config, issues);

  return issues;
}

/**
 * Cotas de tamaño y tipo de las cadenas libres del snapshot.
 *
 * Corre SIEMPRE, no sólo en el camino AIU: el snapshot de un perfil estándar es
 * el mismo `jsonb` de un registro fiscal. Comprueba `typeof` antes de medir
 * porque el DTO no valida nada dentro de `config` (ver `CONFIG_LIMITS`), así que
 * un campo declarado `string` puede llegar como número y `.length` sería
 * `undefined` — una comparación que se evalúa a `false` y deja pasar el valor.
 */
function validateBounds(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const text = (
    value: unknown,
    field: string,
    max: number,
    { required = false } = {},
  ): void => {
    if (value === undefined || value === null) {
      if (required) {
        issues.push({
          field,
          code: 'TEXT_REQUIRED',
          message: `«${field}» es obligatorio.`,
        });
      }
      return;
    }
    if (typeof value !== 'string') {
      issues.push({
        field,
        code: 'EXPECTED_STRING',
        message: `«${field}» tiene que ser texto.`,
      });
      return;
    }
    if (value.length > max) {
      issues.push({
        field,
        code: 'TEXT_TOO_LONG',
        message: `«${field}» admite hasta ${max} caracteres (llegaron ${value.length}).`,
      });
    }
  };

  text(config.general?.description, 'general.description', CONFIG_LIMITS.description);
  text(
    config.general?.internal_note,
    'general.internal_note',
    CONFIG_LIMITS.internal_note,
  );

  if (config.aiu) {
    // Obligatorio y acotado: viaja al `cbc:Note` de la linea de Administracion
    // (CAV03), asi que su ausencia ya la reporta `AIU_CONTRACT_OBJECT_EMPTY` y
    // su exceso rechazaria el documento tras quemar el consecutivo.
    text(
      config.aiu.contract_object,
      'aiu.contract_object',
      CONFIG_LIMITS.contract_object,
    );
  }

  text(
    config.accounting?.vat_payable_account,
    'accounting.vat_payable_account',
    CONFIG_LIMITS.account_code,
  );
  const byBucket = config.accounting?.revenue_account_by_bucket;
  if (byBucket) {
    for (const bucket of AIU_BUCKETS) {
      text(
        byBucket[bucket],
        `accounting.revenue_account_by_bucket.${bucket}`,
        CONFIG_LIMITS.account_code,
      );
    }
  }

  const overrides = config.accounting?.mapping_key_overrides;
  if (overrides) {
    const keys = Object.keys(overrides);
    if (keys.length > CONFIG_LIMITS.mapping_overrides_count) {
      issues.push({
        field: 'accounting.mapping_key_overrides',
        code: 'TOO_MANY_ITEMS',
        message: `Se admiten hasta ${CONFIG_LIMITS.mapping_overrides_count} sobrescrituras de cuenta (llegaron ${keys.length}).`,
      });
    }
    for (const key of keys.slice(0, CONFIG_LIMITS.mapping_overrides_count)) {
      if (key.length > CONFIG_LIMITS.mapping_key) {
        issues.push({
          field: `accounting.mapping_key_overrides.${key.slice(0, 20)}…`,
          code: 'TEXT_TOO_LONG',
          message: `Las claves de mapeo admiten hasta ${CONFIG_LIMITS.mapping_key} caracteres.`,
        });
        continue;
      }
      text(
        overrides[key],
        `accounting.mapping_key_overrides.${key}`,
        CONFIG_LIMITS.account_code,
      );
    }
  }

  // Codigo de tributo: forma, no pertenencia. La tabla 13.2.2 del anexo vive en
  // `dian-tax-codes.ts`, que este archivo NO puede importar —es agnostico del
  // runtime y se copia al frontend—. Duplicar la tabla acá la dejaria rancia
  // ante el primer tributo nuevo, asi que la pertenencia se comprueba en la
  // emision, que si importa el catalogo, y acá sólo se descarta lo que no puede
  // ser un codigo en ningun caso.
  (config.taxes?.rules ?? []).forEach((rule, index) => {
    if (typeof rule?.tax_code !== 'string' || !/^\d{2}$/.test(rule.tax_code)) {
      issues.push({
        field: `taxes.rules[${index}].tax_code`,
        code: 'TAX_CODE_MALFORMED',
        message: `El codigo de tributo tiene que ser dos digitos (por ejemplo «01» para IVA). Llego «${String(rule?.tax_code)}».`,
      });
    }
  });

  const lines = config.model_lines ?? [];
  if (lines.length > CONFIG_LIMITS.model_lines_count) {
    issues.push({
      field: 'model_lines',
      code: 'TOO_MANY_ITEMS',
      message: `Se admiten hasta ${CONFIG_LIMITS.model_lines_count} lineas modelo (llegaron ${lines.length}).`,
    });
  }
  lines.slice(0, CONFIG_LIMITS.model_lines_count).forEach((line, index) => {
    text(
      line?.description,
      `model_lines[${index}].description`,
      CONFIG_LIMITS.line_description,
    );
    text(line?.unit_code, `model_lines[${index}].unit_code`, CONFIG_LIMITS.unit_code);
    text(
      line?.unit_price,
      `model_lines[${index}].unit_price`,
      CONFIG_LIMITS.unit_price,
    );
  });

  text(config.currency?.code, 'currency.code', CONFIG_LIMITS.currency_code);

  text(config.format?.template_key, 'format.template_key', CONFIG_LIMITS.template_key);
  text(
    config.dian?.payment_means_code,
    'dian.payment_means_code',
    CONFIG_LIMITS.payment_code,
  );
  text(
    config.dian?.payment_method_code,
    'dian.payment_method_code',
    CONFIG_LIMITS.payment_code,
  );

  text(
    config.dian?.resolution_number,
    'dian.resolution_number',
    CONFIG_LIMITS.resolution_number,
  );

  const notes = config.dian?.header_notes;
  if (notes) {
    if (notes.length > CONFIG_LIMITS.header_notes_count) {
      issues.push({
        field: 'dian.header_notes',
        code: 'TOO_MANY_ITEMS',
        message: `Se admiten hasta ${CONFIG_LIMITS.header_notes_count} notas de cabecera (llegaron ${notes.length}).`,
      });
    }
    notes
      .slice(0, CONFIG_LIMITS.header_notes_count)
      .forEach((note, index) =>
        text(note, `dian.header_notes[${index}]`, CONFIG_LIMITS.header_note),
      );
  }
}

function validateAiuSection(
  aiu: ProfileAiuConfig,
  issues: ProfileConfigIssue[],
): void {
  if (!AIU_TAXABLE_COMPONENTS_BY_REGIME[aiu.regime]) {
    issues.push({
      field: 'aiu.regime',
      code: 'AIU_REGIME_UNKNOWN',
      message: `El régimen «${String(aiu.regime)}» no existe. Elige E.T. art. 462-1 o Decreto 1372/1992.`,
    });
  }

  // ── La base gravable declarada, si viene ──
  if (
    aiu.taxable_basis !== undefined &&
    aiu.taxable_basis !== null &&
    !AIU_TAXABLE_BASES.includes(aiu.taxable_basis)
  ) {
    issues.push({
      field: 'aiu.taxable_basis',
      code: 'AIU_TAXABLE_BASIS_UNKNOWN',
      message: `La base gravable «${String(aiu.taxable_basis)}» no existe. Elige Subtotal, AIU completo o Utilidad.`,
    });
  }
  const taxableBasis = resolveAiuTaxableBasis(aiu);

  // ── La unidad de los porcentajes ──
  if (
    aiu.components_basis !== undefined &&
    aiu.components_basis !== null &&
    !AIU_COMPONENTS_BASES.includes(aiu.components_basis)
  ) {
    issues.push({
      field: 'aiu.components_basis',
      code: 'AIU_BASIS_UNKNOWN',
      message: `La unidad «${String(aiu.components_basis)}» no existe: los porcentajes se miden sobre el valor del contrato («contract») o sobre el AIU («aiu»).`,
    });
  }
  const basis = resolveAiuComponentsBasis(aiu);

  // ── Los tres porcentajes ──
  let sum = 0;
  let allParsed = true;
  for (const component of AIU_COMPONENTS) {
    const scaled = parsePercentScaled(aiu.components?.[component]);
    if (scaled === null) {
      allParsed = false;
      issues.push({
        field: `aiu.components.${component}`,
        code: 'AIU_PERCENT_INVALID',
        message: `El porcentaje de ${component} no es un número válido con hasta dos decimales.`,
      });
      continue;
    }
    sum += scaled;
  }

  const floorScaled = parsePercentScaled(aiu.minimum_base_percent);

  if (allParsed && basis === 'aiu' && sum !== PERCENT_TOTAL_SCALED) {
    issues.push({
      field: 'aiu.components',
      code: 'AIU_PERCENT_SUM',
      message: `Medidos sobre el AIU, los tres porcentajes deben sumar 100% (actual: ${formatPercentScaled(sum)}%).`,
    });
  }

  if (allParsed && basis === 'contract') {
    // Medidos sobre el contrato, la suma ES el AIU. Puede ser cualquier cosa
    // entre un punto y el 100% —un contrato sin costo reembolsable es todo
    // AIU— pero nunca cero ni mas del contrato entero.
    if (sum <= 0 || sum > PERCENT_TOTAL_SCALED) {
      issues.push({
        field: 'aiu.components',
        code: 'AIU_PERCENT_SUM_OF_CONTRACT',
        message: `Medidos sobre el valor del contrato, los tres porcentajes suman el AIU: tiene que estar entre 0,01% y 100% (actual: ${formatPercentScaled(sum)}%).`,
      });
    } else if (
      // Esta es la unica compuerta del sistema que puede atajar una base
      // gravable insuficiente ANTES de que exista un consecutivo gastado. Con
      // la unidad `'aiu'` la suma es siempre 100 y no dice nada del contrato,
      // asi que el piso solo se podia comprobar al calcular el documento —o
      // sea, con el numero ya asignado y el rechazo de la DIAN por delante.
      taxableBasis === 'aiu' &&
      aiu.enforce_minimum_base === true &&
      floorScaled !== null &&
      sum < floorScaled
    ) {
      issues.push({
        field: 'aiu.components',
        code: 'AIU_PERCENT_SUM_BELOW_FLOOR',
        message: `El AIU configurado es el ${formatPercentScaled(sum)}% del contrato, por debajo del piso del ${formatPercentScaled(floorScaled)}% que exige el E.T. art. 462-1. Toda factura emitida con este perfil nacería sub-declarada.`,
      });
    }
  }

  // ── El piso no puede bajar del legal, y sólo rige bajo et_462_1 ──
  const floor = floorScaled;
  if (floor === null) {
    issues.push({
      field: 'aiu.minimum_base_percent',
      code: 'AIU_FLOOR_INVALID',
      message:
        'El porcentaje del piso legal no es un número válido con hasta dos decimales.',
    });
  } else if (
    taxableBasis === 'aiu' &&
    aiu.enforce_minimum_base &&
    floor < AIU_LEGAL_FLOOR_PERCENT_SCALED
  ) {
    // Subirlo SÍ se permite: declara más IVA, que es el lado recuperable del
    // error. Bajarlo declara de menos ante la DIAN, que es sanción e intereses.
    issues.push({
      field: 'aiu.minimum_base_percent',
      code: 'AIU_FLOOR_BELOW_LEGAL',
      message: `Bajo el E.T. art. 462-1 la base gravable no puede ser inferior al ${formatPercentScaled(AIU_LEGAL_FLOOR_PERCENT_SCALED)}% del valor del contrato. Configuraste ${formatPercentScaled(floor)}%.`,
    });
  }

  if (typeof aiu.enforce_minimum_base !== 'boolean') {
    issues.push({
      field: 'aiu.enforce_minimum_base',
      code: 'AIU_ENFORCE_NOT_EXPLICIT',
      message:
        'Hay que decir explícitamente si se aplica el piso legal: en un snapshot la ausencia no puede significar «sí».',
    });
  }

  // ── El modelo de contabilización ──
  // Dos problemas distintos a propósito: «ese modelo no existe» es un cliente
  // mal escrito, y «existe pero todavía no» es una compuerta con fecha. Pintar
  // el mismo mensaje para los dos dejaría al operador sin saber si esperar.
  if (aiu.accounting_model !== undefined && aiu.accounting_model !== null) {
    if (!ACCOUNTING_MODELS.includes(aiu.accounting_model)) {
      issues.push({
        field: 'aiu.accounting_model',
        code: 'AIU_ACCOUNTING_MODEL_UNKNOWN',
        message: `El modelo de contabilización «${String(aiu.accounting_model)}» no existe. Elige base AIU sumada al total de la factura o no sumada.`,
      });
    } else if (!isAccountingModelEnabled(aiu.accounting_model)) {
      // Bloqueante, no aviso: un perfil guardado con el modelo no habilitado
      // emitiría documentos que la DIAN rechaza al firmar, con el consecutivo
      // ya tomado. Ver `ENABLED_ACCOUNTING_MODELS`.
      issues.push({
        field: 'aiu.accounting_model',
        code: 'AIU_ACCOUNTING_MODEL_NOT_ENABLED',
        message: `El modelo «base AIU no sumada al total de la factura» todavía no se puede guardar. ${accountingModelDisabledReason(aiu.accounting_model) ?? ''}`.trim(),
      });
    }
  }

  if (!aiu.contract_object || !aiu.contract_object.trim()) {
    issues.push({
      field: 'aiu.contract_object',
      code: 'AIU_CONTRACT_OBJECT_EMPTY',
      message:
        'Describe el objeto del contrato: la DIAN valida esa nota en la línea de Administración (regla CAV03) y sin ella rechaza la factura.',
    });
  }
}

function validateTaxSection(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const rules = config.taxes?.rules ?? [];
  const seen = new Set<string>();

  rules.forEach((rule, index) => {
    const at = `taxes.rules[${index}]`;

    if (!AIU_BUCKETS.includes(rule.bucket)) {
      issues.push({
        field: `${at}.bucket`,
        code: 'TAX_BUCKET_UNKNOWN',
        message: `«${String(rule.bucket)}» no es una porción válida del contrato.`,
      });
      return;
    }
    if (seen.has(rule.bucket)) {
      // Dos reglas para la misma porción es una contradicción sin resolución
      // determinista: cuál gana dependería del orden del arreglo.
      issues.push({
        field: `${at}.bucket`,
        code: 'TAX_BUCKET_DUPLICATED',
        message: `Hay dos reglas de impuesto para ${rule.bucket}. Deja una sola.`,
      });
      return;
    }
    seen.add(rule.bucket);

    const rate = parsePercentScaled(rule.rate);
    if (rate === null) {
      issues.push({
        field: `${at}.rate`,
        code: 'TAX_RATE_INVALID',
        message: `La tarifa de ${rule.bucket} no es un número válido con hasta dos decimales.`,
      });
    }

    if (!rule.taxable && rate !== null && rate !== 0) {
      // Éste es exactamente el descuadre que la DIAN rechaza por FAU04: una
      // porción que no declara impuesto pero trae tarifa.
      issues.push({
        field: `${at}.rate`,
        code: 'TAX_RATE_ON_NON_TAXABLE',
        message: `${rule.bucket} está marcado como no gravado pero tiene tarifa ${rule.rate}%. Un documento que declare las dos cosas se rechaza.`,
      });
    }

    if (rule.taxable && rate !== null) {
      if (rule.tax_code === '01' && !IVA_RATES_SCALED.has(rate)) {
        issues.push({
          field: `${at}.rate`,
          code: 'TAX_RATE_NOT_IN_DIAN_LIST',
          message: `La DIAN sólo admite 0%, 5%, 16% y 19% de IVA. ${rule.rate}% se rechaza.`,
        });
      }
      if (rule.tax_code === '04' && !INC_RATES_SCALED.has(rate)) {
        issues.push({
          field: `${at}.rate`,
          code: 'TAX_RATE_NOT_IN_DIAN_LIST',
          message: `La DIAN sólo admite 2%, 4%, 8% y 16% de INC. ${rule.rate}% se rechaza.`,
        });
      }
      // Otros tributos: no se valida la tarifa. Las listas de retefuente están
      // indexadas por CONCEPTO, no por porcentaje —hay porcentajes repetidos
      // para conceptos distintos—, así que una lista de porcentajes sueltos
      // daría falsa seguridad sin impedir el error que importa. Ver la nota de
      // `dian-tax-codes.ts` sobre `TarifaImpuestoReteFuente`.
    }
  });

  // ── La matriz no puede contradecir la base gravable declarada ──
  //
  // Un solo recorrido gobernado por AIU_TAXABLE_BUCKETS_BY_BASIS, que es la
  // ÚNICA tabla que sabe qué porciones entran a la base para cada una de las
  // tres bases. Antes había un `return` temprano bajo «subtotal» que apagaba
  // las cuatro guardas de golpe —la regla ausente, la contradicción por
  // componente y la del costo—, con el argumento de que bajo esa base la
  // gravabilidad la decide `isAiuTaxable` y no la matriz. Cierto para el costo,
  // falso para todo lo demás: `administracion.taxable = false` pasaba muda y
  // `isAiuTaxable` la grava igual, así que el perfil validaba limpio y sus
  // documentos morían en INVOICING_AIU_004 al emitir, con consecutivo ya
  // asignado. La matriz sigue gobernada bajo las tres bases; lo que cambia por
  // base es QUÉ dice la tabla, no si se valida.
  if (!config.aiu) return;
  const taxableBasis = resolveAiuTaxableBasis(config.aiu);
  const expectedTaxable = AIU_TAXABLE_BUCKETS_BY_BASIS[taxableBasis];
  if (!expectedTaxable) return;
  const basisLabel = describeTaxableBasis(taxableBasis);

  for (const bucket of AIU_BUCKETS) {
    const rule = rules.find((r) => r.bucket === bucket);
    const shouldBeTaxable = expectedTaxable.includes(bucket);

    if (!rule) {
      // El costo sólo necesita regla cuando ENTRA en la base: bajo «aiu» y
      // «utilidad» queda fuera por definición y exigirla rompería todo perfil
      // que hoy no la declara. Bajo «subtotal» el costo es la porción más
      // grande del contrato, y sin tarifa la emisión no sabe cómo gravarla.
      if (bucket === 'costo' && !shouldBeTaxable) continue;
      issues.push({
        field: `taxes.rules.${bucket}`,
        code: 'TAX_RULE_MISSING',
        message: `Falta la regla de impuesto de ${bucket}. Sin ella la emisión no sabe a qué tarifa gravarla y la factura puede salir declarando de menos.`,
      });
      continue;
    }

    if (rule.taxable === shouldBeTaxable) continue;

    if (bucket === 'costo' && !shouldBeTaxable) {
      // El costo reembolsable fuera de la base es lo que distingue un contrato
      // AIU de una venta ordinaria. Si entrara, el piso legal se mediría contra
      // un contrato y el IVA contra otro.
      issues.push({
        field: 'taxes.rules.costo.taxable',
        code: 'TAX_COST_MUST_NOT_BE_TAXABLE',
        message: `El costo reembolsable no forma parte de la base gravable bajo ${basisLabel}.`,
      });
      continue;
    }

    issues.push({
      field: `taxes.rules.${bucket}.taxable`,
      code: 'TAX_MATRIX_CONTRADICTS_REGIME',
      message: shouldBeTaxable
        ? `Bajo ${basisLabel} la base gravable incluye ${bucket}, así que no puede quedar sin gravar.`
        : `Bajo ${basisLabel} la base gravable no incluye ${bucket}, así que no puede quedar gravado.`,
    });
  }
}

/**
 * Nombre de la base gravable para un mensaje de error. Se dice la BASE y no el
 * régimen porque «subtotal» no tiene régimen legal al que colapsar: los
 * mensajes que interpolaban `config.aiu.regime` imprimían el régimen heredado
 * —o `undefined`— sobre un perfil cuya base era otra.
 */
function describeTaxableBasis(basis: AiuTaxableBasis): string {
  switch (basis) {
    case 'aiu':
      return 'la base AIU completo (E.T. art. 462-1)';
    case 'utilidad':
      return 'la base sólo utilidad (Decreto 1372/1992)';
    case 'subtotal':
      return 'la base Subtotal (sin tratamiento AIU)';
  }
}

function validateModelLines(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  (config.model_lines ?? []).forEach((line, index) => {
    const at = `model_lines[${index}]`;
    if (!AIU_BUCKETS.includes(line.bucket)) {
      issues.push({
        field: `${at}.bucket`,
        code: 'LINE_BUCKET_UNKNOWN',
        message: `«${String(line.bucket)}» no es una porción válida del contrato.`,
      });
    }
    if (!line.description || !line.description.trim()) {
      issues.push({
        field: `${at}.description`,
        code: 'LINE_DESCRIPTION_EMPTY',
        message:
          'Cada línea modelo necesita descripción: es la que viaja al documento.',
      });
    }
    if (line.quantity != null && parsePercentScaled(line.quantity) === null) {
      issues.push({
        field: `${at}.quantity`,
        code: 'LINE_QUANTITY_INVALID',
        message: 'La cantidad no es un número válido con hasta dos decimales.',
      });
    }
    // El precio NO se mide con `parsePercentScaled`: ese parser acota a dos
    // decimales porque un `cbc:Percent` lleva dos, y el precio unitario del
    // anexo admite seis. Medirlo con la regla del porcentaje rechazaría un
    // precio legítimo de un servicio prorrateado por hora.
    // La cadena vacía cuenta como AUSENTE, no como precio ilegal: el editor
    // envía `''` cuando el campo se deja en blanco, y ese es justamente el caso
    // legítimo —«el precio se teclea en cada factura»—. Rechazarlo volvería
    // inguardable un perfil al que nadie le puso precio.
    const price =
      typeof line.unit_price === 'string' ? line.unit_price.trim() : line.unit_price;
    if (price != null && price !== '' && !isDecimalString(price, 6)) {
      issues.push({
        field: `${at}.unit_price`,
        code: 'LINE_UNIT_PRICE_INVALID',
        message:
          'El precio unitario tiene que ser un número no negativo con hasta seis decimales, o quedar vacío.',
      });
    }
  });
}

/**
 * `true` si la cadena es un decimal no negativo con como máximo `maxDecimals`
 * decimales.
 *
 * Deliberadamente NO usa `Number(value)`: `Number('')` es `0`, `Number(' 1 ')`
 * es `1` y `Number('1e3')` es `1000` — tres cadenas que ningún importe fiscal
 * debería aceptar y que un chequeo por conversión dejaría pasar convertidas en
 * algo distinto de lo que el usuario escribió.
 */
function isDecimalString(value: unknown, maxDecimals: number): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(value);
  if (!match) return false;
  return (match[2]?.length ?? 0) <= maxDecimals;
}

function validateFormat(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const decimals = config.format?.display_decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    issues.push({
      field: 'format.display_decimals',
      code: 'FORMAT_DECIMALS_OUT_OF_RANGE',
      message: 'Los decimales a mostrar tienen que ser un entero entre 0 y 6.',
    });
  }
  if (typeof config.format?.show_aiu_breakdown !== 'boolean') {
    issues.push({
      field: 'format.show_aiu_breakdown',
      code: 'FORMAT_BREAKDOWN_NOT_BOOLEAN',
      message: 'Hay que decir si se imprime el desglose de AIU.',
    });
  }
  // `template_id` es una FK logica a `print_templates`. Aca solo se exige que
  // sea un entero positivo; que EXISTA y que pertenezca a la organizacion lo
  // decide quien imprime, no el validador del snapshot: el snapshot es
  // inmutable y la plantilla se puede borrar despues de timbrar la factura.
  // Rechazar el perfil por una plantilla borrada volveria irrepetible la
  // impresion de un documento ya emitido.
  const templateId = config.format?.template_id;
  if (
    templateId !== undefined &&
    templateId !== null &&
    (!Number.isInteger(templateId) || (templateId as number) <= 0)
  ) {
    issues.push({
      field: 'format.template_id',
      code: 'FORMAT_TEMPLATE_ID_INVALID',
      message:
        'La plantilla de impresion tiene que ser el identificador de una plantilla del Hub (entero positivo) o quedar vacia.',
    });
  }
}

/**
 * La sección DIAN: forma, no vigencia.
 *
 * `resolution_id` es una FK logica a `invoicing_resolutions`, y lo que se
 * comprueba acá es que pueda ser un identificador — nada mas. Que EXISTA, que
 * este vigente, que le quede consecutivo y que no sea el rango de habilitacion
 * lo decide quien precarga la factura, contra la lista de resoluciones de la
 * tienda y con la fecha de HOY.
 *
 * POR QUE LA VIGENCIA NO SE VALIDA ACA. Un snapshot es inmutable y la
 * numeracion autorizada caduca: si guardar el perfil exigiera una resolucion
 * vigente, el dia que venciera el rango quedaria inguardable un perfil correcto
 * en todo lo demas —no se podria ni corregirle una cuenta contable— hasta que
 * alguien registrara el rango nuevo. Y al contrario: validar la vigencia al
 * GUARDAR no prueba nada sobre el momento de EMITIR, que es meses despues.
 *
 * El riesgo que esto deja abierto —un id de otra tienda metido a mano en el
 * `jsonb`— no lo cierra este validador sino el consumidor: la precarga solo
 * honra ids que esten en la lista de resoluciones de la propia tienda, asi que
 * un id ajeno no llega nunca a preseleccionarse ni a viajar a la emision.
 */
function validateDianSection(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const resolutionId = config.dian?.resolution_id;
  if (
    resolutionId !== undefined &&
    resolutionId !== null &&
    (!Number.isInteger(resolutionId) || (resolutionId as number) <= 0)
  ) {
    issues.push({
      field: 'dian.resolution_id',
      code: 'DIAN_RESOLUTION_ID_INVALID',
      message:
        'La resolucion preferida tiene que ser el identificador de una resolucion registrada (entero positivo) o quedar vacia.',
    });
  }

  const documentType = config.dian?.document_type;
  if (
    documentType !== undefined &&
    documentType !== null &&
    // `String(...)` y no `documentType !== ''`: el tipo declarado no incluye la
    // cadena vacía, así que la comparación directa es un error de compilación
    // —y el dato SÍ puede llegar vacío, porque el `jsonb` no está tipado.
    String(documentType) !== '' &&
    !PROFILE_DOCUMENT_TYPES.includes(documentType as ProfileDocumentType)
  ) {
    issues.push({
      field: 'dian.document_type',
      code: 'DIAN_DOCUMENT_TYPE_UNKNOWN',
      message: `El tipo de documento «${String(documentType)}» no existe. Elige factura de venta o factura de exportación.`,
    });
  }
}

/**
 * Las retenciones del perfil: concepto, lado y tarifa. Nunca la base.
 *
 * ## Por qué una tarifa en cero SÍ bloquea
 *
 * En la matriz de impuestos, `'0.00'` con `taxable: true` es legítimo: un
 * servicio exento declara su grupo con `Percent` en cero, y eso es distinto de
 * no declarar el tributo. Una RETENCIÓN al 0 % no tiene ese significado: no
 * existe la retención exenta. Una fila así precarga una retención que no retiene
 * nada, el operador la ve puesta y da por hecho que el cálculo está cubierto.
 * Vale más no dejar guardarla.
 */
function validateWithholdings(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const rules = config.withholdings?.rules ?? [];
  if (rules.length > CONFIG_LIMITS.withholding_rules_count) {
    issues.push({
      field: 'withholdings.rules',
      code: 'TOO_MANY_ITEMS',
      message: `Se admiten hasta ${CONFIG_LIMITS.withholding_rules_count} retenciones por omisión (llegaron ${rules.length}).`,
    });
  }

  const seen = new Set<string>();
  rules
    .slice(0, CONFIG_LIMITS.withholding_rules_count)
    .forEach((rule, index) => {
      const at = `withholdings.rules[${index}]`;

      if (!Number.isInteger(rule?.concept_id) || rule.concept_id <= 0) {
        issues.push({
          field: `${at}.concept_id`,
          code: 'WITHHOLDING_CONCEPT_INVALID',
          message:
            'Cada retención necesita el concepto al que corresponde: sin él la fila no se puede resolver al emitir.',
        });
      }

      if (!WITHHOLDING_ROLES.includes(rule?.role)) {
        issues.push({
          field: `${at}.role`,
          code: 'WITHHOLDING_ROLE_UNKNOWN',
          message:
            'Hay que decir si la tienda practica la retención o la sufre: son asientos y declaraciones distintas.',
        });
      }

      const rate = parsePercentScaled(rule?.rate);
      if (rate === null) {
        issues.push({
          field: `${at}.rate`,
          code: 'WITHHOLDING_RATE_INVALID',
          message:
            'La tarifa de retención tiene que ser un porcentaje con hasta dos decimales.',
        });
      } else if (rate === 0) {
        issues.push({
          field: `${at}.rate`,
          code: 'WITHHOLDING_RATE_ZERO',
          message:
            'Una retención al 0 % no retiene nada y aparentaría estar configurada. Pon la tarifa o quita la fila.',
        });
      } else if (rate > PERCENT_TOTAL_SCALED) {
        issues.push({
          field: `${at}.rate`,
          code: 'WITHHOLDING_RATE_OUT_OF_RANGE',
          message: 'La tarifa de retención no puede pasar del 100 %.',
        });
      }

      // Dos filas del mismo concepto y el mismo lado retendrían DOS VECES sobre
      // la misma base. El duplicado no es redundancia: es una retención doble.
      const key = `${String(rule?.concept_id)}|${String(rule?.role)}`;
      if (seen.has(key)) {
        issues.push({
          field: `${at}.concept_id`,
          code: 'WITHHOLDING_RULE_DUPLICATED',
          message:
            'Este concepto ya está en la lista con el mismo lado de la operación: se retendría dos veces sobre la misma base.',
        });
      }
      seen.add(key);
    });
}

/**
 * La divisa del perfil.
 *
 * `COP` se rechaza a propósito: la factura ya se emite en pesos, así que
 * declarar pesos como divisa ALTERNA no declara ninguna conversión y produce un
 * `cac:PaymentAlternativeExchangeRate` que dice que un peso vale un peso. Es la
 * clase de dato que pasa toda validación de forma y no significa nada.
 */
function validateCurrency(
  config: InvoiceProfileConfig,
  issues: ProfileConfigIssue[],
): void {
  const currency = config.currency ?? {};
  const code = typeof currency.code === 'string' ? currency.code.trim() : '';

  if (code !== '' && !/^[A-Z]{3}$/.test(code)) {
    issues.push({
      field: 'currency.code',
      code: 'CURRENCY_CODE_INVALID',
      message:
        'La divisa tiene que ser un código ISO 4217 de tres letras mayúsculas (USD, EUR…).',
    });
  } else if (code === 'COP') {
    issues.push({
      field: 'currency.code',
      code: 'CURRENCY_CODE_IS_LOCAL',
      message:
        'La factura ya se emite en pesos colombianos: como divisa alterna, COP no declara ninguna conversión. Elige otra o deja la sección apagada.',
    });
  }

  if (currency.declare_foreign === true && code === '') {
    issues.push({
      field: 'currency.code',
      code: 'CURRENCY_CODE_REQUIRED',
      message:
        'Si el perfil declara conversión a divisa extranjera, hay que decir a cuál.',
    });
  }
}

/**
 * Snapshot por omisión de un perfil AIU bajo el régimen conservador.
 *
 * El régimen por omisión es `et_462_1` porque grava el AIU COMPLETO, o sea
 * declara MÁS IVA que el otro: si el default estuviera equivocado, el
 * contribuyente pagó de más —recuperable— en vez de haber declarado de menos
 * ante la DIAN, que es sanción e intereses.
 */
export function buildDefaultAiuProfileConfig(
  contract_object = '',
): InvoiceProfileConfig {
  return {
    config_version: INVOICE_PROFILE_CONFIG_VERSION,
    general: { description: null, internal_note: null },
    aiu: {
      regime: 'et_462_1',
      contract_object,
      enforce_minimum_base: true,
      minimum_base_percent: formatPercentScaled(
        AIU_LEGAL_FLOOR_PERCENT_SCALED,
      ),
      // Medidos sobre el CONTRATO, y sumando exactamente el piso legal del
      // 10 %: 5 + 2 + 3. Es el reparto con que se redacta un contrato de aseo o
      // vigilancia, y deja el 90 % restante como costo reembolsable.
      components_basis: 'contract',
      components: {
        administracion: '5.00',
        imprevistos: '2.00',
        utilidad: '3.00',
      },
      // Explícito aunque la ausencia signifique lo mismo: un perfil recién
      // creado no debe depender de un default implícito para decidir la forma
      // del XML.
      accounting_model: 'sumada',
    },
    accounting: {
      revenue_account_by_bucket: null,
      vat_payable_account: null,
      mapping_key_overrides: null,
    },
    taxes: {
      rules: [
        { bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'imprevistos', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
      ],
    },
    model_lines: [],
    format: {
      template_id: null,
      template_key: null,
      show_aiu_breakdown: true,
      display_decimals: 2,
    },
    dian: {
      document_type: null,
      payment_means_code: null,
      payment_method_code: null,
      header_notes: null,
      resolution_id: null,
      resolution_number: null,
    },
    // Sin retenciones y sin divisa: un perfil recién creado no puede saber a
    // quién se le retiene. Sembrar una retención por omisión pondría una fila
    // que el operador vería puesta y daría por revisada.
    withholdings: { rules: [] },
    currency: { declare_foreign: false, code: null },
  };
}

// ─── Límites de tamaño ────────────────────────────────────────────────────

/**
 * Cotas de longitud y cardinalidad del snapshot.
 *
 * ## Por qué existen acá y no en el DTO
 *
 * El DTO declara `config` como objeto validado **sin** `@ValidateNested`, porque
 * `forbidNonWhitelisted` recorre el árbol anidado y rechazaría cualquier clave
 * que un `@ValidateNested` no declare — y las siete secciones tienen decenas de
 * campos opcionales. Consecuencia: `class-validator` no mira NADA dentro de
 * `config`. Sin estas cotas, el snapshot —que es un `jsonb` de un registro
 * fiscal referenciado por facturas timbradas— aceptaría cadenas de megabytes y
 * arreglos sin fin.
 *
 * Las que van al XML llevan además la cota del anexo: `contract_object` se
 * concatena al `cbc:Note` de la línea de Administración (regla CAV03), y un
 * `Note` desmedido es un documento rechazado tras quemar el consecutivo.
 *
 * `contract_object` vale 4900 y no una cifra propia **a propósito**: es el mismo
 * dato que `CreateInvoiceDto.aiu_contract_object`, que ya lleva
 * `@MaxLength(4900)` porque CAV03 acota la nota COMPLETA a 5000 y el prefijo
 * obligatorio ocupa el resto. Una cota más baja acá haría que un objeto de
 * contrato legítimo se pudiera escribir en la factura pero no guardar como
 * valor por omisión del perfil — la misma regla midiendo distinto según por
 * dónde entre el dato.
 */
export const CONFIG_LIMITS = {
  description: 500,
  internal_note: 1000,
  contract_object: 4900,
  account_code: 20,
  mapping_key: 100,
  mapping_overrides_count: 200,
  line_description: 300,
  unit_code: 4,
  model_lines_count: 50,
  template_key: 100,
  payment_code: 4,
  header_note: 500,
  header_notes_count: 10,
  resolution_number: 60,
  withholding_rules_count: 20,
  currency_code: 3,
  unit_price: 24,
} as const;

// ─── Normalización estructural ────────────────────────────────────────────

/**
 * Resultado de normalizar una configuración recibida del cliente.
 *
 * Trae la configuración **proyectada** sobre la forma conocida y los problemas
 * ESTRUCTURALES encontrados. La división con `validateInvoiceProfileConfig` es
 * deliberada y no cosmética:
 *
 * - el normalizador decide **qué claves existen** (estructura),
 * - el validador decide **si los valores son legales** (semántica).
 *
 * Por eso el normalizador **no convierte ni un solo valor**. Si coercionara,
 * una tarifa inválida se volvería una tarifa de aspecto válido y el validador
 * la dejaría pasar: el dato fiscal habría cambiado en silencio, que es
 * exactamente el fallo que este plan existe para impedir.
 */
export interface ConfigNormalizationResult {
  config: InvoiceProfileConfig;
  issues: ProfileConfigIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

/**
 * Copia sólo las claves conocidas y **reporta** las demás.
 *
 * No las descarta en silencio a propósito: un descarte callado le dice al
 * cliente que su campo se guardó cuando no se guardó, y la divergencia se
 * descubre al emitir. Reportarlas convierte el mismo hecho en un 422 que nombra
 * la clave — el mismo criterio que `forbidNonWhitelisted` aplica en la raíz.
 */
function pickKnownKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ProfileConfigIssue[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) {
      issues.push({
        field: joinPath(path, key),
        code: 'UNKNOWN_KEY',
        message: `El campo «${key}» no forma parte de la configuración del perfil y no se guardaría. Quítalo.`,
      });
      continue;
    }
    out[key] = source[key];
  }
  return out;
}

function expectObject(
  value: unknown,
  path: string,
  issues: ProfileConfigIssue[],
): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    issues.push({
      field: path,
      code: 'EXPECTED_OBJECT',
      message: `La sección «${path}» tiene que ser un objeto.`,
    });
    return {};
  }
  return value;
}

function expectArray(
  value: unknown,
  path: string,
  issues: ProfileConfigIssue[],
): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push({
      field: path,
      code: 'EXPECTED_ARRAY',
      message: `«${path}» tiene que ser una lista.`,
    });
    return [];
  }
  return value;
}

const GENERAL_KEYS = ['description', 'internal_note'] as const;
const AIU_KEYS = [
  'regime',
  'taxable_basis',
  'contract_object',
  'enforce_minimum_base',
  'minimum_base_percent',
  'components_basis',
  'components',
  // Sin esta entrada, `pickKnownKeys` BORRA el campo y emite `UNKNOWN_KEY`, que
  // es bloqueante: las cuatro rutas de escritura de perfil responderían 422
  // nombrando un campo del propio contrato. Ya pasó con `taxable_basis`.
  'accounting_model',
] as const;
const ACCOUNTING_KEYS = [
  'revenue_account_by_bucket',
  'vat_payable_account',
  'mapping_key_overrides',
] as const;
const TAXES_KEYS = ['rules'] as const;
const TAX_RULE_KEYS = ['bucket', 'taxable', 'tax_code', 'rate'] as const;
const WITHHOLDINGS_KEYS = ['rules'] as const;
const WITHHOLDING_RULE_KEYS = ['concept_id', 'role', 'rate'] as const;
const CURRENCY_KEYS = ['declare_foreign', 'code'] as const;
const MODEL_LINE_KEYS = [
  'bucket',
  'description',
  'unit_code',
  'quantity',
  'unit_price',
] as const;
const FORMAT_KEYS = [
  'template_id',
  'template_key',
  'show_aiu_breakdown',
  'display_decimals',
] as const;
const DIAN_KEYS = [
  'document_type',
  'payment_means_code',
  'payment_method_code',
  'header_notes',
  'resolution_id',
  'resolution_number',
] as const;
const ROOT_KEYS = [
  'config_version',
  'general',
  'aiu',
  'accounting',
  'taxes',
  'model_lines',
  'format',
  'dian',
  'withholdings',
  'currency',
] as const;

/**
 * Proyecta una entrada arbitraria sobre `InvoiceProfileConfig`.
 *
 * **Nunca lanza.** Un mismo problema tiene que producir una sola forma de
 * error: si el normalizador lanzara, una configuración inválida saldría a veces
 * como excepción del normalizador y a veces como lista de `issues` del
 * validador, y el editor del frontend —que marca campos por
 * `details.issues[].field`— no podría pintar la primera.
 *
 * `config_version` se copia **tal cual viene**, incluso si no es un número: es
 * el cliente quien declara con qué forma escribió el snapshot, y el validador
 * es quien la acepta o la rechaza. Fijarla aquí al valor del servidor
 * convertiría un frontend desactualizado en un snapshot mal etiquetado.
 */
export function normalizeInvoiceProfileConfig(
  input: unknown,
): ConfigNormalizationResult {
  const issues: ProfileConfigIssue[] = [];

  if (!isPlainObject(input)) {
    issues.push({
      field: 'config',
      code: 'CONFIG_NOT_OBJECT',
      message: 'La configuración del perfil tiene que ser un objeto.',
    });
    return { config: emptyConfigShell(), issues };
  }

  const root = pickKnownKeys(input, ROOT_KEYS, '', issues);

  const general = pickKnownKeys(
    expectObject(root['general'], 'general', issues),
    GENERAL_KEYS,
    'general',
    issues,
  ) as unknown as ProfileGeneralConfig;

  // `aiu: null` es legítimo (perfil no-AIU) y distinto de ausente: la ausencia
  // también se normaliza a null, y es el validador quien decide si el tipo de
  // operación la exigía (`AIU_SECTION_REQUIRED`).
  let aiu: ProfileAiuConfig | null = null;
  if (root['aiu'] !== undefined && root['aiu'] !== null) {
    const raw = pickKnownKeys(
      expectObject(root['aiu'], 'aiu', issues),
      AIU_KEYS,
      'aiu',
      issues,
    );
    raw['components'] = pickKnownKeys(
      expectObject(raw['components'], 'aiu.components', issues),
      AIU_COMPONENTS,
      'aiu.components',
      issues,
    );
    aiu = raw as unknown as ProfileAiuConfig;
  }

  const accountingRaw = pickKnownKeys(
    expectObject(root['accounting'], 'accounting', issues),
    ACCOUNTING_KEYS,
    'accounting',
    issues,
  );
  if (
    accountingRaw['revenue_account_by_bucket'] !== undefined &&
    accountingRaw['revenue_account_by_bucket'] !== null
  ) {
    accountingRaw['revenue_account_by_bucket'] = pickKnownKeys(
      expectObject(
        accountingRaw['revenue_account_by_bucket'],
        'accounting.revenue_account_by_bucket',
        issues,
      ),
      AIU_BUCKETS,
      'accounting.revenue_account_by_bucket',
      issues,
    );
  }
  // `mapping_key_overrides` es el ÚNICO mapa de claves libres del snapshot: sus
  // claves son `mapping_key` del módulo contable, que cada tenant extiende. No
  // se pueden enumerar acá sin duplicar ese catálogo y quedar rancio. Lo que sí
  // se acota es la forma (ver `validateBounds`), porque un mapa libre sin cota
  // es un `jsonb` sin cota.
  if (
    accountingRaw['mapping_key_overrides'] !== undefined &&
    accountingRaw['mapping_key_overrides'] !== null
  ) {
    accountingRaw['mapping_key_overrides'] = expectObject(
      accountingRaw['mapping_key_overrides'],
      'accounting.mapping_key_overrides',
      issues,
    );
  }
  const accounting = accountingRaw as unknown as ProfileAccountingConfig;

  const taxesRaw = pickKnownKeys(
    expectObject(root['taxes'], 'taxes', issues),
    TAXES_KEYS,
    'taxes',
    issues,
  );
  const rules = expectArray(taxesRaw['rules'], 'taxes.rules', issues).map(
    (entry, index) =>
      pickKnownKeys(
        expectObject(entry, `taxes.rules[${index}]`, issues),
        TAX_RULE_KEYS,
        `taxes.rules[${index}]`,
        issues,
      ) as unknown as ProfileTaxRule,
  );

  const model_lines = expectArray(
    root['model_lines'],
    'model_lines',
    issues,
  ).map(
    (entry, index) =>
      pickKnownKeys(
        expectObject(entry, `model_lines[${index}]`, issues),
        MODEL_LINE_KEYS,
        `model_lines[${index}]`,
        issues,
      ) as unknown as ProfileModelLine,
  );

  const format = pickKnownKeys(
    expectObject(root['format'], 'format', issues),
    FORMAT_KEYS,
    'format',
    issues,
  ) as unknown as ProfileFormatConfig;

  const dianRaw = pickKnownKeys(
    expectObject(root['dian'], 'dian', issues),
    DIAN_KEYS,
    'dian',
    issues,
  );
  if (dianRaw['header_notes'] !== undefined && dianRaw['header_notes'] !== null) {
    dianRaw['header_notes'] = expectArray(
      dianRaw['header_notes'],
      'dian.header_notes',
      issues,
    );
  }
  const dian = dianRaw as unknown as ProfileDianConfig;

  // Las dos secciones nuevas se proyectan igual que `taxes`: la ausencia da la
  // sección vacía SIN reportar problema. Un perfil guardado antes de que
  // existieran no precargaba retenciones ni divisa, que es exactamente lo que
  // significa la sección vacía — tratar la ausencia como error volvería
  // «incompatible» todo perfil anterior sin que ningún dato hubiera cambiado.
  const withholdingsRaw = pickKnownKeys(
    expectObject(root['withholdings'], 'withholdings', issues),
    WITHHOLDINGS_KEYS,
    'withholdings',
    issues,
  );
  const withholdingRules = expectArray(
    withholdingsRaw['rules'],
    'withholdings.rules',
    issues,
  ).map(
    (entry, index) =>
      pickKnownKeys(
        expectObject(entry, `withholdings.rules[${index}]`, issues),
        WITHHOLDING_RULE_KEYS,
        `withholdings.rules[${index}]`,
        issues,
      ) as unknown as ProfileWithholdingRule,
  );

  const currency = pickKnownKeys(
    expectObject(root['currency'], 'currency', issues),
    CURRENCY_KEYS,
    'currency',
    issues,
  ) as unknown as ProfileCurrencyConfig;

  return {
    config: {
      config_version: root['config_version'] as number,
      general,
      aiu,
      accounting,
      taxes: { rules },
      model_lines,
      format,
      dian,
      withholdings: { rules: withholdingRules },
      currency,
    },
    issues,
  };
}

/**
 * Cascarón con las siete secciones presentes y vacías.
 *
 * Se devuelve cuando la entrada no era ni un objeto. Devolver `null` obligaría a
 * cada llamador a distinguir dos caminos de fallo para el mismo 422; con el
 * cascarón, el validador corre igual y suma sus propios problemas a los del
 * normalizador, y el editor recibe una sola lista.
 */
function emptyConfigShell(): InvoiceProfileConfig {
  return {
    config_version: undefined as unknown as number,
    general: {},
    aiu: null,
    accounting: {},
    taxes: { rules: [] },
    model_lines: [],
    format: undefined as unknown as ProfileFormatConfig,
    dian: {},
    withholdings: { rules: [] },
    currency: {},
  };
}
