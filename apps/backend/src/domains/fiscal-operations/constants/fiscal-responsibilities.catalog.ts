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

import { normalizeFiscalResponsibilityCode } from '@common/constants/fiscal-responsibilities';

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
  /**
   * Indica si la responsabilidad ha sido derogada o es de carácter histórico.
   */
  is_historical?: boolean;
  /**
   * Base legal de la responsabilidad o de su derogación.
   */
  legal_basis?: string[];
}

/**
 * v3: Ampliación del catálogo canónico a responsabilidades vigentes 01-61 de la
 * casilla 53 del RUT más R-99-PN, identificación de obligaciones automáticas
 * (`obligation_types`) y marcación de códigos históricos/derogados con base legal.
 */
export const FISCAL_RESPONSIBILITIES_CATALOG_VERSION = 3;

export const FISCAL_RESPONSIBILITIES_CATALOG: FiscalResponsibilityDefinition[] =
  [
    {
      code: 'O-01',
      label: 'Aporte especial para la administración de justicia',
      description:
        'Aporte específico para notarías correspondiente al porcentaje de ingresos brutos notariales no subsidiados.',
      effects: [
        'Aplica exclusivamente al sector notarial',
        'Genera deber de liquidación y pago especial ante la DIAN',
      ],
      legal_basis: ['Ley 6 de 1992 Art. 135'],
    },
    {
      code: 'O-02',
      label: 'Gravamen a los movimientos financieros (GMF)',
      description:
        'Responsable del recaudo y declaración del impuesto del 4x1000 sobre transacciones financieras.',
      effects: [
        'Actúa como agente retenedor y declarante de GMF',
        'Aplica a entidades financieras y vigiladas por la Superintendencia Financiera',
      ],
      legal_basis: ['Art. 871 Estatuto Tributario'],
    },
    {
      code: 'O-03',
      label: 'Impuesto al patrimonio (histórico)',
      description:
        'Código histórico para contribuyentes obligados en vigencias pasadas al impuesto al patrimonio.',
      effects: [
        'Código de carácter histórico / derogado según normativa DIAN',
      ],
      is_historical: true,
      legal_basis: ['Ley 1370 de 2009 (Temporal / Derogada)'],
    },
    {
      code: 'O-04',
      label: 'Impuesto sobre la renta - Régimen tributario especial',
      description:
        'Entidades sin ánimo de lucro (ESAL), fundaciones y corporaciones calificadas en el régimen especial con tarifa preferencial.',
      effects: [
        'Tarifa preferencial sobre el beneficio neto o excedente',
        'Proceso anual de actualización de registro web ante la DIAN',
      ],
      obligation_types: ['income_tax_precierre'],
      legal_basis: ['Art. 19 y 356 Estatuto Tributario'],
    },
    {
      code: 'O-05',
      label: 'Impuesto sobre la renta - Régimen ordinario',
      description:
        'Contribuyente obligado a liquidar y declarar impuesto sobre la renta y complementarios bajo las reglas generales del régimen ordinario.',
      effects: [
        'Declaración anual de renta y complementarios',
        'Cálculo y liquidación obligatoria de anticipo de renta para el año siguiente',
      ],
      obligation_types: ['income_tax_precierre'],
      legal_basis: ['Art. 5 y 240 Estatuto Tributario'],
    },
    {
      code: 'O-06',
      label: 'Ingresos y patrimonio',
      description:
        'Entidades no contribuyentes de renta pero legalmente obligadas a presentar declaración informativa de ingresos y patrimonio.',
      effects: [
        'Presentación formal anual de declaración de ingresos y patrimonio',
        'Sin liquidación de impuesto a pagar',
      ],
      legal_basis: ['Art. 598 Estatuto Tributario'],
    },
    {
      code: 'O-07',
      label: 'Retención en la fuente a título de renta',
      description:
        'Agente de retención en la fuente por compras y pagos de bienes o servicios a terceros a título del impuesto sobre la renta.',
      effects: [
        'Obligación de practicar retención en la fuente a proveedores aplicables',
        'Declaración mensual de retenciones en la fuente (Formulario 350)',
        'Expedición anual de certificados de retención a proveedores',
      ],
      obligation_types: ['withholding_return'],
      legal_basis: ['Art. 368 Estatuto Tributario'],
    },
    {
      code: 'O-08',
      label: 'Retención timbre nacional',
      description:
        'Agente retenedor del impuesto de timbre nacional en documentos y contratos que superen cuantías legales.',
      effects: [
        'Retención y pago del impuesto de timbre en actos notariales o contractuales aplicables',
      ],
      legal_basis: ['Art. 518 Estatuto Tributario'],
    },
    {
      code: 'O-09',
      label: 'Retención en la fuente en el impuesto sobre las ventas (IVA)',
      description:
        'Agente de retención del IVA en compras de bienes y servicios gravados a proveedores responsables de IVA.',
      effects: [
        'Práctica obligatoria de ReteIVA según calidades tributarias',
        'Presentación de retenciones practicadas en formulario mensual de retención',
      ],
      obligation_types: ['reteiva_return'],
      legal_basis: ['Art. 437-1 y 437-2 Estatuto Tributario'],
    },
    {
      code: 'O-10',
      label: 'Obligado aduanero (usuario aduanero)',
      description:
        'Interviniente en operaciones de comercio exterior (importador, exportador o usuario aduanero directo).',
      effects: [
        'Cumplimiento de formalidades y trámites aduaneros ante la DIAN',
        'Registro de declaraciones de importación o exportación',
      ],
      legal_basis: ['Decreto 1165 de 2019'],
    },
    {
      code: 'O-11',
      label: 'Ventas régimen común (histórico)',
      description:
        'Código histórico del régimen común, sustituido formalmente por el código 48 (Responsable de IVA).',
      effects: [
        'Código de carácter histórico / derogado según normativa DIAN',
      ],
      is_historical: true,
      legal_basis: ['Ley 1943 de 2018 / Ley 2010 de 2019 (Sustituido por 48)'],
    },
    {
      code: 'O-12',
      label: 'Ventas régimen simplificado (histórico)',
      description:
        'Código histórico del régimen simplificado, sustituido formalmente por el código 49 (No responsable de IVA).',
      effects: [
        'Código de carácter histórico / derogado según normativa DIAN',
      ],
      is_historical: true,
      legal_basis: ['Ley 1943 de 2018 / Ley 2010 de 2019 (Sustituido por 49)'],
    },
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
      legal_basis: ['Art. 562 Estatuto Tributario'],
    },
    {
      code: 'O-14',
      label: 'Informante de exógena',
      description:
        'Obligado formal a suministrar anualmente a la DIAN información en medios magnéticos (información exógena).',
      effects: [
        'Presentación obligatoria de formatos de exógena según resolución anual',
        'Sanciones estrictas por no reporte o reporte extemporáneo',
      ],
      obligation_types: ['exogenous_report'],
      legal_basis: ['Art. 631 Estatuto Tributario'],
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
      legal_basis: ['Art. 365 Estatuto Tributario'],
    },
    {
      code: 'O-16',
      label: 'Obligado a facturar por ingresos excluidos',
      description:
        'Personas naturales o jurídicas que venden bienes o servicios excluidos y están formalmente obligadas a emitir factura de venta.',
      effects: [
        'Obligación formal de expedir factura de venta en operaciones no gravadas',
      ],
      legal_basis: ['Art. 616-1 Estatuto Tributario'],
    },
    {
      code: 'O-17',
      label: 'Profesionales de compra y venta de divisas',
      description:
        'Personas autorizadas para ejercer de manera profesional la compra y venta de divisas y moneda extranjera.',
      effects: [
        'Libros de control cambiario y reporte de operaciones a la UIAF',
        'Supervisión y control aduanero y cambiario por la DIAN',
      ],
      legal_basis: ['Resolución Externa 8 de 2000 Banco de la República'],
    },
    {
      code: 'O-18',
      label: 'Precios de transferencia',
      description:
        'Contribuyente sujeto al régimen de precios de transferencia por celebrar operaciones con partes vinculadas en el exterior o zonas francas.',
      effects: [
        'Elaboración y conservación de documentación comprobatoria e informe local',
      ],
      legal_basis: ['Art. 260-1 Estatuto Tributario'],
    },
    {
      code: 'O-19',
      label: 'Productor y/o exportador de bienes exentos',
      description:
        'Contribuyente productor o exportador de bienes exentos de IVA con derecho a solicitar devoluciones de saldos a favor.',
      effects: [
        'Derecho a devolución bimestral del IVA descontable en insumos',
        'Declaración bimestral obligatoria de IVA',
      ],
      legal_basis: ['Art. 477, 479 y 481 Estatuto Tributario'],
    },
    {
      code: 'O-20',
      label: 'Obtención de NIT',
      description:
        'Código informativo de trámite asignado en el proceso inicial de asignación del NIT ante la DIAN.',
      effects: [
        'Informativo en la fase preliminar de registro ante el RUT',
      ],
      legal_basis: ['Art. 555-2 Estatuto Tributario'],
    },
    {
      code: 'O-21',
      label: 'Declarar ingreso o salida de divisas o moneda legal',
      description:
        'Obligación formal de declarar la entrada o salida física de divisas o moneda legal colombiana que supere los montos reglamentarios.',
      effects: [
        'Declaración obligatoria en puntos aduaneros y puertos de frontera',
      ],
      legal_basis: ['Decreto 4048 de 2008'],
    },
    {
      code: 'O-22',
      label: 'Obligado a cumplir deberes formales a nombre de terceros',
      description:
        'Representantes legales, apoderados, liquidadores, tutores o curadores designados para cumplir obligaciones fiscales en representación de otros.',
      effects: [
        'Firma de declaraciones y trámites ante la DIAN en calidad de representante',
        'Responsabilidad solidaria y subsidiaria fijada por el Estatuto Tributario',
      ],
      legal_basis: ['Art. 572 Estatuto Tributario'],
    },
    {
      code: 'O-23',
      label: 'Agente de retención IVA (ReteIVA)',
      description:
        'Cuando compras a ciertos proveedores debes retener una parte del IVA de la operación y entregarla a la DIAN en la declaración de retenciones.',
      effects: [
        'Debes practicar reteIVA en compras que apliquen',
        'Las retenciones practicadas generan declaración mensual de retención',
      ],
      obligation_types: ['reteiva_return'],
      legal_basis: ['Art. 437-2 Estatuto Tributario'],
    },
    {
      code: 'O-24',
      label: 'Declaración consolidada precios de transferencia',
      description:
        'Obligación formal de presentar informe o declaración consolidada de precios de transferencia en grupos empresariales.',
      effects: [
        'Reporte de informe maestro y consolidado para entidades del grupo',
      ],
      legal_basis: ['Art. 260-9 Estatuto Tributario'],
    },
    {
      code: 'O-26',
      label: 'Declaración individual precios de transferencia',
      description:
        'Obligación de presentar la declaración informativa individual de precios de transferencia.',
      effects: [
        'Presentación del formulario de precios de transferencia individual',
      ],
      legal_basis: ['Art. 260-9 Estatuto Tributario'],
    },
    {
      code: 'O-32',
      label: 'Impuesto nacional a la gasolina y al ACPM',
      description:
        'Responsable del impuesto aplicable a distribuidores mayoristas e importadores de combustibles fósiles derivados del petróleo.',
      effects: [
        'Liquidación y declaración mensual del impuesto a la gasolina y ACPM',
        'Control estricto de inventarios y cupos de combustible',
      ],
      legal_basis: ['Ley 1607 de 2012 Art. 167'],
    },
    {
      code: 'O-33',
      label: 'Impuesto nacional al consumo (INC)',
      description:
        'Responsable de recaudar y declarar el impuesto nacional al consumo en actividades de expendio de alimentos y bebidas o telefonía.',
      effects: [
        'Cobro de la tarifa del INC en el punto de venta (ej. 8% en restaurantes)',
        'Declaración bimestral obligatoria de impuesto nacional al consumo',
      ],
      obligation_types: ['inc_return'],
      legal_basis: ['Art. 512-1 Estatuto Tributario'],
    },
    {
      code: 'O-35',
      label: 'Impuesto al patrimonio personas jurídicas (derogada)',
      description:
        'Código histórico para el impuesto al patrimonio y riqueza corporativa de vigencias anteriores.',
      effects: [
        'Código de carácter histórico / derogado según normativa DIAN',
      ],
      is_historical: true,
      legal_basis: ['Ley 1739 de 2014 (Derogada)'],
    },
    {
      code: 'O-36',
      label: 'Establecimiento permanente (derogada)',
      description:
        'Código histórico para establecimientos permanentes en Colombia de personas del exterior.',
      effects: [
        'Código de carácter histórico / derogado según normativa DIAN',
      ],
      is_historical: true,
      legal_basis: ['Art. 20-1 Estatuto Tributario (Suprimida de casilla 53)'],
    },
    {
      code: 'O-37',
      label: 'Obligado a facturar electrónicamente (derogada / ver 52)',
      description:
        'Código histórico de obligatoriedad en el modelo inicial de facturación electrónica, sustituido por el código 52.',
      effects: [
        'Código de carácter histórico / sustituido por responsabilidad 52',
      ],
      is_historical: true,
      legal_basis: ['Resolución DIAN 000042 de 2020 (Sustituida por 52)'],
    },
    {
      code: 'O-38',
      label: 'Facturación electrónica voluntaria (derogada / ver 52)',
      description:
        'Código histórico de adopción voluntaria de factura electrónica, unificado en la responsabilidad 52.',
      effects: [
        'Código de carácter histórico / sustituido por responsabilidad 52',
      ],
      is_historical: true,
      legal_basis: ['Resolución DIAN 000042 de 2020 (Sustituida por 52)'],
    },
    {
      code: 'O-39',
      label: 'Proveedor de servicios tecnológicos PST (derogada)',
      description:
        'Código histórico de registro para proveedores de tecnología autorizados en facturación electrónica.',
      effects: [
        'Código de carácter histórico / derogado de casilla 53',
      ],
      is_historical: true,
      legal_basis: ['Resolución DIAN 000042 de 2020'],
    },
    {
      code: 'O-41',
      label: 'Declaración anual de activos en el exterior',
      description:
        'Personas naturales o jurídicas residentes fiscales que posean bienes o activos en el exterior superiores a los topes fijados por ley.',
      effects: [
        'Presentación anual del formulario 160 de activos en el exterior',
        'Cruces de información bancaria internacional bajo FATCA y CRS',
      ],
      legal_basis: ['Art. 607 Estatuto Tributario'],
    },
    {
      code: 'O-42',
      label: 'Obligado a llevar contabilidad',
      description:
        'Personas obligadas a registrar sus hechos económicos mediante contabilidad por partida doble conforme a las normas NIIF vigentes.',
      effects: [
        'Llevar libros contables oficiales y estados financieros',
        'Soporte probatorio indispensable ante la DIAN',
      ],
      obligation_types: ['monthly_close', 'annual_close'],
      legal_basis: ['Código de Comercio Art. 19 / DUR 2420 de 2015'],
    },
    {
      code: 'O-45',
      label: 'Autorretenedor de rendimientos financieros',
      description:
        'Entidades facultadas expresamente para autorretenerse sobre rendimientos e intereses financieros.',
      effects: [
        'Autorretención directa sobre pagos de rendimientos recibidos',
      ],
      legal_basis: ['Art. 365 ET / Decreto Reglamentario 2418 de 2013'],
    },
    {
      code: 'O-46',
      label: 'IVA prestadores de servicios desde el exterior (derogada)',
      description:
        'Código histórico de prestadores sin domicilio en el país, reorganizado en régimen de tributación directa.',
      effects: [
        'Código de carácter histórico / derogado según normativa DIAN',
      ],
      is_historical: true,
      legal_basis: ['Resolución DIAN 000051 de 2018'],
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
      legal_basis: ['Art. 903 a 916 Estatuto Tributario'],
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
      legal_basis: ['Art. 437 Estatuto Tributario'],
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
      legal_basis: ['Art. 437 ET, parágrafo 3'],
    },
    {
      code: 'O-50',
      label: 'No responsable de consumo restaurantes y bares',
      description:
        'Establecimientos de comidas y bebidas cuyos ingresos brutos del año anterior no superan el tope legal y no deben cobrar el impuesto al consumo.',
      effects: [
        'Venta de alimentos y bebidas sin recargo de impuesto al consumo',
        'Control estricto de topes de ingresos brutos anuales',
      ],
      legal_basis: ['Art. 512-13 Estatuto Tributario'],
    },
    {
      code: 'O-51',
      label: 'Agente de retención impoconsumo bienes inmuebles',
      description:
        'Agente retenedor del impuesto al consumo en la venta o cesión de bienes inmuebles que superen los umbrales legales.',
      effects: [
        'Retención del impuesto al consumo en transacciones inmobiliarias gravadas',
      ],
      legal_basis: ['Art. 512-22 Estatuto Tributario'],
    },
    {
      code: 'O-52',
      label: 'Facturador electrónico',
      description:
        'Comercio formalmente habilitado u obligado por la DIAN a expedir factura electrónica de venta y documentos equivalentes electrónicos.',
      effects: [
        'Emisión obligatoria de facturas y notas en formato XML UBL 2.1 validado por la DIAN',
        'Generación y transmisión electrónica del documento soporte en compras a no obligados',
      ],
      obligation_types: ['electronic_invoice_review', 'support_document_review'],
      legal_basis: ['Art. 616-1 ET / Resolución DIAN 000165 de 2023'],
    },
    {
      code: 'O-53',
      label: 'Persona jurídica no responsable de IVA',
      description:
        'Personas jurídicas que realizan exclusivamente operaciones excluidas o no sujetas a IVA.',
      effects: [
        'Emisión de facturas sin IVA',
        'El IVA asumido en compras opera como costo o gasto deducible',
      ],
      legal_basis: ['Art. 437 Estatuto Tributario'],
    },
    {
      code: 'O-54',
      label: 'Intercambio automático de información CRS',
      description:
        'Instituciones obligadas a reportar ante la DIAN cuentas financieras bajo los estándares de la OCDE.',
      effects: [
        'Reporte anual de debida diligencia de cuentas financieras extranjeras',
      ],
      legal_basis: ['Resolución DIAN 000119 de 2015'],
    },
    {
      code: 'O-55',
      label: 'Informante de beneficiarios finales (RUB)',
      description:
        'Personas jurídicas y estructuras sin personería jurídica obligadas a registrar e informar sus beneficiarios finales en el RUB.',
      effects: [
        'Identificación obligatoria de personas naturales controlantes o con participación >= 5%',
        'Actualización trimestral en caso de modificaciones en la composición societaria',
      ],
      legal_basis: ['Art. 631-5 ET / Resolución DIAN 000164 de 2021'],
    },
    {
      code: 'O-56',
      label: 'Impuesto nacional al carbono',
      description:
        'Responsables de la venta, importación o retiro de combustibles fósiles gravados con el impuesto al carbono.',
      effects: [
        'Liquidación y declaración bimestral del impuesto al carbono',
      ],
      legal_basis: ['Ley 1819 de 2016 Art. 221'],
    },
    {
      code: 'O-57',
      label: 'Declaración de activos en el exterior simplificada',
      description:
        'Contribuyentes que califican para el reporte abreviado de activos poseídos fuera del territorio nacional.',
      effects: [
        'Cumplimiento simplificado de la obligación de reporte exterior',
      ],
      legal_basis: ['Art. 607 Estatuto Tributario'],
    },
    {
      code: 'O-58',
      label: 'Intercambio automático de información FATCA',
      description:
        'Instituciones financieras colombianas sujetas al acuerdo intergubernamental FATCA con el gobierno de Estados Unidos.',
      effects: [
        'Reporte de cuentas financieras de ciudadanos o residentes fiscales estadounidenses',
      ],
      legal_basis: ['Ley 1666 de 2013'],
    },
    {
      code: 'O-59',
      label: 'Autorretención especial de renta',
      description:
        'Sociedades y personas jurídicas beneficiarias de la exoneración de aportes de nómina (Ley 1819) sujetas a autorretención de renta.',
      effects: [
        'Cálculo mensual de la autorretención especial sobre ingresos gravados (0.4%, 0.8% o tarifa según actividad)',
        'Pago y declaración mensual en el formulario 350',
      ],
      obligation_types: ['withholding_return'],
      legal_basis: ['Decreto 2201 de 2016 / Art. 365 ET'],
    },
    {
      code: 'O-60',
      label: 'Autorretención intereses y rendimientos financieros',
      description:
        'Obligación de practicar autorretención en la fuente sobre ingresos provenientes de intereses y rendimientos de capital.',
      effects: [
        'Liquidación de retención en la fuente por rendimientos financieros generados',
      ],
      legal_basis: ['Decreto 2418 de 2013'],
    },
    {
      code: 'O-61',
      label: 'Régimen tributario especial - sector cooperativo',
      description:
        'Cooperativas, uniones y ligas cooperativas reguladas por la legislación cooperativa que tributan con tarifa especial del 20%.',
      effects: [
        'Inversión y destinación obligatoria de excedentes cooperativos',
        'Declaración anual de renta con tarifa preferencial del 20%',
      ],
      obligation_types: ['income_tax_precierre'],
      legal_basis: ['Art. 19-4 Estatuto Tributario'],
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
      legal_basis: ['Anexo Técnico UBL 2.1 Regla FAK26'],
    },
  ];

/**
 * Busca una definición por código DIAN. Admite código canónico ('O-48') o un código
 * sin normalizar ('48', 'R-99-PJ'). Devuelve `undefined` si no se encuentra.
 */
export function findFiscalResponsibility(
  code: string,
): FiscalResponsibilityDefinition | undefined {
  // Delega en el normalizador canónico (ADR-03/ADR-04): '48' -> 'O-48',
  // 'o-5' -> 'O-05', 'R-99-PJ' -> 'R-99-PN'. La lógica inline anterior no
  // rellenaba el prefijo de un dígito ('O-5'/'o-5' fallaban la búsqueda).
  const normalized = normalizeFiscalResponsibilityCode(code);
  if (!normalized) return undefined;

  return FISCAL_RESPONSIBILITIES_CATALOG.find((entry) => entry.code === normalized);
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
