/**
 * Catálogo hardcoded y versionado de responsabilidades fiscales DIAN
 * (casilla 53 del RUT) soportadas por Vendix.
 *
 * Las responsabilidades se persisten como códigos (`string[]`) en
 * `settings.fiscal_data.tax_responsibilities` (organization_settings o
 * store_settings según fiscal_scope). Este catálogo es la fuente de verdad
 * para:
 *
 * - La UI del Centro Fiscal (labels, descripciones en lenguaje llano y
 *   tooltips de efectos por responsabilidad).
 * - La generación condicionada de obligaciones fiscales
 *   (`FiscalObligationService.defaultTypesForContext`): qué tipos de
 *   `fiscal_obligations` habilita cada responsabilidad.
 *
 * Versionar el catálogo permite a la UI cachear y detectar cambios sin
 * migraciones: incrementar `FISCAL_RESPONSIBILITIES_CATALOG_VERSION` al
 * agregar/editar entradas.
 */

/** Periodicidad de declaración de IVA (art. 600 ET). */
export type VatPeriodicity = 'monthly' | 'bimonthly' | 'four_monthly';

export const VAT_PERIODICITIES: VatPeriodicity[] = [
  'monthly',
  'bimonthly',
  'four_monthly',
];

/**
 * CP-PURCHASE-TRANSPARENCY B.3 — efecto de la responsabilidad EN LAS COMPRAS.
 *
 * Las descripciones y `effects` del catálogo están redactados desde la
 * perspectiva de la VENTA («tus facturas», «tus ventas») y ninguno menciona qué
 * pasa con el IVA que el comercio PAGA al comprar. Esa es justamente la
 * pregunta que una pantalla de compras tiene que responder antes de capitalizar
 * el IVA de una factura al costo de los productos.
 *
 * El texto vive aquí, en el catálogo oficial, y no incrustado en un componente:
 * una sola fuente para el copy fiscal, versionada, y la misma frase en la vista
 * previa de costo, en la confirmación y en el recibo.
 */
export interface FiscalPurchaseEffect {
  /**
   * Qué hace el motor de costeo con el IVA de la compra.
   * - `deductible`   el IVA no es costo: va a IVA descontable (240804) y se
   *                  resta del IVA generado en ventas.
   * - `capitalized`  el IVA es mayor valor del costo del inventario.
   */
  treatment: 'deductible' | 'capitalized';
  /** Español llano, listo para pintar. Sin jerga de código ni nombres de campo. */
  message: string;
  /**
   * Base legal citada al usuario. Se cita SOLO lo que sostiene la afirmación:
   * una cita equivocada en pantalla es peor que ninguna, porque el operador la
   * repite ante su contador.
   */
  legal_basis: string[];
}

export interface FiscalResponsibilityDefinition {
  /** Código DIAN de la casilla 53 del RUT (ej. 'O-48'). */
  code: string;
  /** Nombre corto para la UI (ej. 'Responsable de IVA'). */
  label: string;
  /** Descripción en lenguaje llano para usuarios no expertos. */
  description: string;
  /** Efectos prácticos en Vendix — pensado para tooltips de la UI. */
  effects: string[];
  /**
   * Tipos de `fiscal_obligations` que esta responsabilidad habilita en la
   * generación automática de obligaciones. Ausente ⇒ la responsabilidad es
   * informativa y no habilita obligaciones por sí misma.
   */
  obligation_types?: string[];
  /**
   * B.3 — efecto en COMPRAS. Presente solo en las responsabilidades que
   * determinan el tratamiento del IVA pagado (O-48 / O-49); el resto son
   * informativas para este propósito.
   */
  purchase_effect?: FiscalPurchaseEffect;
}

/**
 * B.3 — v2: cada definición de O-48 y O-49 incorpora `purchase_effect` (el
 * efecto del IVA pagado en compras, con su base legal). La UI cachea por esta
 * versión, así que incrementarla es lo que hace visible el texto nuevo sin
 * migración.
 */
export const FISCAL_RESPONSIBILITIES_CATALOG_VERSION = 2;

export const FISCAL_RESPONSIBILITIES_CATALOG: FiscalResponsibilityDefinition[] =
  [
    {
      code: 'O-13',
      label: 'Gran contribuyente',
      description:
        'La DIAN te clasificó como gran contribuyente por el tamaño de tu operación. Tienes fechas de vencimiento especiales y mayores controles en tus declaraciones.',
      effects: [
        'Calendario tributario especial definido por la DIAN',
        'Generalmente actúas como agente de retención en tus compras',
        'Mayor frecuencia de fiscalización y obligaciones formales',
      ],
    },
    {
      code: 'O-15',
      label: 'Autorretenedor',
      description:
        'Tú mismo te aplicas la retención en la fuente sobre tus ingresos, en lugar de que te la practiquen tus clientes. Debes declararla y pagarla periódicamente.',
      effects: [
        'Tus clientes no deben practicarte retención en la fuente',
        'Debes calcular y pagar tu propia autorretención',
      ],
    },
    {
      code: 'O-23',
      label: 'Agente de retención IVA',
      description:
        'Cuando compras a ciertos proveedores debes retener una parte del IVA de la operación y entregarla a la DIAN en la declaración de retenciones.',
      effects: [
        'Debes practicar reteIVA en compras que apliquen',
        'Las retenciones practicadas generan declaración de reteIVA',
      ],
    },
    {
      code: 'O-47',
      label: 'Régimen simple de tributación',
      description:
        'Estás en el régimen SIMPLE: unificas varios impuestos (renta, ICA consolidado y otros) en anticipos bimestrales y una declaración anual, con tarifas según tu actividad.',
      effects: [
        'Anticipos bimestrales y declaración anual consolidada del SIMPLE',
        'No te practican retención en la fuente a título de renta',
        'No actúas como agente de retención (salvo pagos laborales)',
      ],
    },
    {
      code: 'O-48',
      label: 'Responsable de IVA',
      description:
        'Debes cobrar IVA en tus ventas, facturarlo y declararlo periódicamente a la DIAN (cada mes, cada dos meses o cada cuatro meses según tu tamaño).',
      effects: [
        'Tus facturas deben incluir IVA',
        'Genera obligación de declaración de IVA según tu periodicidad',
        'Habilita la revisión del impuesto al consumo (INC) si aplica a tu actividad',
      ],
      obligation_types: ['vat_return', 'inc_return'],
      purchase_effect: {
        treatment: 'deductible',
        message:
          'Como eres responsable de IVA, el IVA que pagas en esta compra no aumenta el costo de tus productos: se registra como IVA descontable y lo restas del IVA que cobras en tus ventas. Si además tienes ventas excluidas de IVA, solo puedes descontar la parte proporcional.',
        legal_basis: [
          'Art. 485 ET — impuestos descontables',
          'Art. 488 ET — solo son descontables los impuestos pagados en bienes y servicios que dan derecho a costo o deducción',
          'Art. 490 ET — prorrateo cuando hay operaciones gravadas y excluidas',
        ],
      },
    },
    {
      code: 'O-49',
      label: 'No responsable de IVA',
      description:
        'No estás obligado a cobrar ni declarar IVA en tus ventas (por nivel de ingresos u otras condiciones del artículo 437 del Estatuto Tributario).',
      effects: [
        'Tus ventas se facturan sin IVA',
        'No se genera obligación de declaración de IVA',
      ],
      purchase_effect: {
        treatment: 'capitalized',
        message:
          'Como no eres responsable de IVA, no puedes descontar el IVA que pagas en tus compras: ese IVA se suma al costo de tus productos. Tu margen se calcula sobre el precio con IVA incluido.',
        legal_basis: [
          'Art. 437 ET, parágrafo 3 — no responsables del IVA',
          'Art. 493 ET — el IVA que no es descontable constituye mayor valor del costo o del gasto',
          'NIIF para PYMES §13.6 / NIC 2 ¶11 — los impuestos no recuperables integran el costo de los inventarios',
        ],
      },
    },
    {
      code: 'R-99-PN',
      label: 'No aplica – otros',
      description:
        'No tienes ninguna de las responsabilidades anteriores. Es el código que la DIAN asigna por defecto, típico de personas naturales sin obligaciones especiales.',
      effects: [
        'Sin obligaciones fiscales especiales asociadas',
        'Tus facturas no llevan IVA ni retenciones por esta responsabilidad',
      ],
    },
  ];

/**
 * B.3 — busca una definición por código DIAN. Devuelve `undefined` si el código
 * no está en el catálogo (un RUT puede traer códigos que Vendix no modela).
 */
export function findFiscalResponsibility(
  code: string,
): FiscalResponsibilityDefinition | undefined {
  return FISCAL_RESPONSIBILITIES_CATALOG.find((entry) => entry.code === code);
}

/**
 * B.3 — efecto en compras de un código DIAN, o `undefined` si esa
 * responsabilidad no determina el tratamiento del IVA pagado.
 *
 * Es el punto de entrada que usa `resolveVatTreatment`
 * (`common/helpers/vat-responsibility.helper.ts`) para que el texto que ve el
 * operador salga del catálogo oficial y no de una cadena escrita en un
 * componente. Si el motor de costeo y este texto discreparan, la interfaz
 * explicaría al revés lo que el sistema hace — peor que no explicar nada.
 */
export function purchaseEffectFor(
  code: string,
): FiscalPurchaseEffect | undefined {
  return findFiscalResponsibility(code)?.purchase_effect;
}
