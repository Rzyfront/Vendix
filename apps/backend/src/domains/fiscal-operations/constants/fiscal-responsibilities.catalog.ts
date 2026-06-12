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
}

export const FISCAL_RESPONSIBILITIES_CATALOG_VERSION = 1;

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
