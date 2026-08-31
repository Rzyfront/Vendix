import 'reflect-metadata';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import {
  getMetadataStorage,
  validate,
  ValidationError,
  ValidatorOptions,
} from 'class-validator';
import {
  CreateInvoiceDto,
  CreateInvoiceItemDto,
  CreateInvoiceTaxDto,
  DIAN_IDENTIFICATION_TYPE_CODES,
} from './create-invoice.dto';
import { InvoiceAddressDto } from './invoice-address.dto';

/**
 * Contrato del DTO de creación de factura (QUI-690, Fase 1).
 *
 * POR QUÉ EXISTE ESTE SPEC
 * ------------------------
 * `apps/backend/src/main.ts` monta el `ValidationPipe` global con
 * `whitelist: true` y `forbidNonWhitelisted: true`. La segunda opción convierte
 * cualquier propiedad que el cliente envíe y el DTO no declare en un **400**,
 * sin excepción y sin aviso previo en compilación.
 *
 * Eso ya pasó: el formulario del panel empezó a serializar `customer_email` y
 * `customer_phone`, el DTO nunca los declaró, y toda creación manual de factura
 * en la que el usuario escribiera correo o teléfono devolvía 400. El módulo de
 * facturación quedó sin poder emitir. Ningún test lo detectó porque el contrato
 * cliente↔DTO no estaba escrito en ningún lado verificable.
 *
 * Este spec lo escribe. Falla ruidosamente, nombra la clave huérfana y explica
 * la causa, para que el próximo campo que nazca en el formulario no llegue a
 * producción como un 400.
 */

/** Opciones EXACTAS del ValidationPipe global (`main.ts`). No las relajes. */
const PIPE_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

/**
 * Claves que el formulario de creación de factura serializa hoy.
 *
 * PROCEDENCIA: transcritas a mano del objeto que
 * `apps/frontend/src/app/private/modules/store/invoicing/components/
 * invoice-create/invoice-create.component.ts` construye en `onSubmit()`
 * (aprox. líneas 714-760: el `itemsPayload` y el `createInvoice({ invoice: … })`).
 *
 * POR QUÉ A MANO Y NO IMPORTADAS: importar un componente Angular dentro de un
 * spec de backend arrastraría todo el runtime de Angular a Jest de Nest y el
 * test dejaría de correr por razones ajenas al contrato. La lista es un
 * contrato escrito deliberadamente a mano: **si el formulario cambia, esta
 * lista se actualiza en el mismo commit**. Ese acoplamiento manual ES el punto
 * del test — obliga a mirar el DTO cada vez que el formulario crece.
 */
const FRONTEND_INVOICE_KEYS = [
  'invoice_type',
  'resolution_id',
  'customer_id',
  'customer_name',
  'customer_tax_id',
  'customer_email',
  'customer_phone',
  'customer_address',
  'issue_date',
  'due_date',
  'notes',
  'items',
] as const;

/** Claves de cada línea (`itemsPayload`, mismas líneas del componente). */
const FRONTEND_ITEM_KEYS = [
  'description',
  'quantity',
  'unit_price',
  'discount_amount',
  'product_id',
  'taxes',
  'is_inclusive',
] as const;

/** Claves de cada impuesto de línea (`taxes: [{ … }]` del mismo bloque). */
const FRONTEND_TAX_KEYS = [
  'tax_rate_id',
  'tax_name',
  'tax_rate',
  'taxable_amount',
  'tax_amount',
  'tax_type',
  'is_inclusive',
] as const;

const isoDay = (offsetDays = 0): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** Un valor plausible por clave, para poder validar el payload completo. */
const FRONTEND_TAX_SAMPLE: Record<string, unknown> = {
  tax_rate_id: 3,
  tax_name: 'IVA 19%',
  tax_rate: 19,
  taxable_amount: 100000,
  tax_amount: 0,
  tax_type: 'iva',
  is_inclusive: false,
};

const FRONTEND_ITEM_SAMPLE: Record<string, unknown> = {
  description: 'Servicio de consultoría',
  quantity: 2,
  unit_price: 50000,
  discount_amount: 0,
  product_id: 12,
  taxes: [FRONTEND_TAX_SAMPLE],
  is_inclusive: false,
};

const FRONTEND_INVOICE_SAMPLE: Record<string, unknown> = {
  invoice_type: 'sales_invoice',
  resolution_id: 7,
  customer_id: 42,
  customer_name: 'Comercializadora Andina S.A.S',
  customer_tax_id: '900123456',
  customer_email: 'cartera@andina.com.co',
  customer_phone: '3001234567',
  customer_address: 'Cra 43A # 1-50, Medellín',
  issue_date: isoDay(),
  due_date: isoDay(30),
  notes: 'Gracias por su compra',
  items: [FRONTEND_ITEM_SAMPLE],
};

/** Payload mínimo válido; base sobre la que cada caso negativo hace un override. */
const baseInvoice = (): Record<string, unknown> => ({
  invoice_type: 'sales_invoice',
  issue_date: isoDay(),
  items: [
    {
      description: 'Servicio de consultoría',
      quantity: 2,
      unit_price: 50000,
    },
  ],
});

/**
 * Valida como lo haría el pipe global: `transform: true` +
 * `enableImplicitConversion: true` en la transformación, `whitelist` +
 * `forbidNonWhitelisted` en la validación.
 */
const validateAsPipe = async (
  payload: Record<string, unknown>,
  target: ClassConstructor<object> = CreateInvoiceDto,
): Promise<ValidationError[]> => {
  const instance = plainToInstance(target, payload, {
    enableImplicitConversion: true,
  });
  return validate(instance, PIPE_OPTIONS);
};

/** Aplana el árbol de errores a rutas tipo `items.0.quantity`. */
const failedPaths = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own = error.constraints ? [path] : [];
    return [...own, ...failedPaths(error.children ?? [], path)];
  });

/** Rutas rechazadas específicamente por `forbidNonWhitelisted`. */
const whitelistOrphans = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own =
      error.constraints && 'whitelistValidation' in error.constraints
        ? [path]
        : [];
    return [...own, ...whitelistOrphans(error.children ?? [], path)];
  });

/**
 * Mensajes de los constraints que fallaron EXACTAMENTE en `path`
 * (`items.0.product_id`, `items.0.taxes.0.tax_rate_id`, …), concatenados.
 *
 * Existe porque «devuelve 400» no es la mitad del contrato: un tope que
 * rechaza sin decir qué campo ni cuánto sobra obliga al comerciante a adivinar,
 * y adivinar sobre una factura llena es cómo se pierde el trabajo de media
 * mañana.
 */
const messagesAt = (errors: ValidationError[], path: string): string => {
  const walk = (list: ValidationError[], prefix = ''): string[] =>
    list.flatMap((error) => {
      const here = prefix ? `${prefix}.${error.property}` : error.property;
      const own =
        here === path && error.constraints
          ? Object.values(error.constraints)
          : [];
      return [...own, ...walk(error.children ?? [], here)];
    });
  return walk(errors).join(' | ');
};

/**
 * Nombres de constraint (`min`, `isNumber`, `maxLength`, …) por propiedad,
 * leídos de los metadatos reales de class-validator.
 *
 * OJO CON `metadata.type` — NO sirve para esto. En class-validator 0.14 todos
 * los decoradores pasan por `ValidateBy`, así que TODOS se registran con
 * `type === 'customValidation'` y el nombre real vive en el constraint
 * asociado (`getTargetValidatorConstraints(metadata.constraintCls)[0].name`).
 * La primera versión de este helper leía `type`, no encontraba ni un
 * `'isNumber'` y devolvía el conjunto vacío: la compuerta de más abajo pasaba
 * **sin comparar nada** y seguía verde con un `@Min` retirado a mano. Por eso
 * el test cuenta cuántas propiedades numéricas encontró antes de juzgarlas.
 */
const constraintNamesByProperty = (
  target: ClassConstructor<object>,
): Map<string, Set<string>> => {
  const storage = getMetadataStorage();
  const metadatas = storage.getTargetValidationMetadatas(
    target,
    target.name,
    true,
    false,
  );
  const byProperty = new Map<string, Set<string>>();
  for (const metadata of metadatas) {
    const names = metadata.constraintCls
      ? storage
          .getTargetValidatorConstraints(metadata.constraintCls)
          .map((constraint) => constraint.name)
      : [metadata.type];
    const bucket = byProperty.get(metadata.propertyName) ?? new Set<string>();
    for (const name of names) bucket.add(name);
    byProperty.set(metadata.propertyName, bucket);
  }
  return byProperty;
};

const assertNoOrphans = (orphans: string[], where: string): void => {
  if (orphans.length === 0) return;
  throw new Error(
    `CONTRATO ROTO — ${where} no declara ${orphans.length} clave(s) que el ` +
      `formulario de creación de factura sí serializa: ${orphans.join(', ')}.\n\n` +
      `El ValidationPipe global (apps/backend/src/main.ts) corre con ` +
      `forbidNonWhitelisted: true, así que una propiedad enviada y no declarada ` +
      `NO se ignora: la petición completa se rechaza con HTTP 400 y el usuario ` +
      `no puede emitir la factura.\n\n` +
      `Arréglalo declarando la propiedad en el DTO (opcional, con su validador ` +
      `y su mensaje en español), o quitándola del payload del componente. Si el ` +
      `formulario cambió a propósito, actualiza también la lista de claves de ` +
      `este spec en el mismo commit.`,
  );
};

describe('CreateInvoiceDto — contrato con el formulario del panel', () => {
  it('declara TODAS las claves que el formulario serializa en la cabecera', async () => {
    const errors = await validateAsPipe(FRONTEND_INVOICE_SAMPLE);
    const orphans = whitelistOrphans(errors);
    assertNoOrphans(orphans, 'CreateInvoiceDto');
    expect(orphans).toHaveLength(0);
  });

  it('declara TODAS las claves que el formulario serializa en cada línea', async () => {
    const errors = await validateAsPipe(
      FRONTEND_ITEM_SAMPLE,
      CreateInvoiceItemDto,
    );
    const orphans = whitelistOrphans(errors);
    assertNoOrphans(orphans, 'CreateInvoiceItemDto');
    expect(orphans).toHaveLength(0);
  });

  it('declara TODAS las claves que el formulario serializa en cada impuesto', async () => {
    const errors = await validateAsPipe(
      FRONTEND_TAX_SAMPLE,
      CreateInvoiceTaxDto,
    );
    const orphans = whitelistOrphans(errors);
    assertNoOrphans(orphans, 'CreateInvoiceTaxDto');
    expect(orphans).toHaveLength(0);
  });

  it('acepta el payload completo del formulario sin un solo error', async () => {
    // La regresión concreta: con `customer_email` y `customer_phone` llenos,
    // esta llamada devolvía 400 en producción.
    const errors = await validateAsPipe(FRONTEND_INVOICE_SAMPLE);
    expect(failedPaths(errors)).toEqual([]);
  });

  it('mantiene sincronizadas las listas de claves del spec (cinturón y tirantes)', () => {
    // Si alguien añade una clave a la lista pero olvida el sample —o al revés—
    // el test de arriba pasaría por vacío. Esto lo impide.
    expect(Object.keys(FRONTEND_INVOICE_SAMPLE).sort()).toEqual(
      [...FRONTEND_INVOICE_KEYS].sort(),
    );
    expect(Object.keys(FRONTEND_ITEM_SAMPLE).sort()).toEqual(
      [...FRONTEND_ITEM_KEYS].sort(),
    );
    expect(Object.keys(FRONTEND_TAX_SAMPLE).sort()).toEqual(
      [...FRONTEND_TAX_KEYS].sort(),
    );
  });

  it('sigue rechazando una propiedad que de verdad no existe', async () => {
    // El test de contrato solo vale si `forbidNonWhitelisted` sigue activo en
    // la configuración que el spec replica.
    const errors = await validateAsPipe({
      ...baseInvoice(),
      campo_inventado: 'x',
    });
    expect(whitelistOrphans(errors)).toContain('campo_inventado');
  });
});

describe('CreateInvoiceDto — campos DIAN nuevos', () => {
  it('acepta el bloque fiscal completo', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_email: 'cartera@andina.com.co',
      customer_phone: '3001234567',
      customer_document_type: '31',
      customer_verification_digit: '7',
      customer_tax_regime: '48',
      customer_fiscal_responsibilities: ['O-13', 'O-15'],
      payment_form: '2',
      payment_means_code: '42',
      operation_type: '09',
      foreign_currency: 'USD',
      foreign_total_amount: 1250.5,
      exchange_rate_date: isoDay(-1),
      exchange_rate: 3950.12,
      currency: 'COP',
      withholding_amount: 25000,
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('acepta los campos DIAN nuevos de la línea', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      operation_type: '09',
      items: [
        {
          description: 'Administración del contrato',
          quantity: 1,
          unit_price: 1000000,
          unit_code: 'NIU',
          account_code: '413595',
          aiu_component: 'administracion',
        },
      ],
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it.each([
    ['13', 'cédula de ciudadanía'],
    ['31', 'NIT'],
    ['22', 'cédula de extranjería'],
  ])('acepta el tipo de documento DIAN %s (%s)', async (code) => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_document_type: code,
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza un tipo de documento fuera del catálogo DIAN', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_document_type: '99',
    });
    expect(failedPaths(errors)).toContain('customer_document_type');
  });

  it('rechaza la sigla en vez del código ("NIT" no es "31")', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_document_type: 'NIT',
    });
    expect(failedPaths(errors)).toContain('customer_document_type');
  });

  it('expone los 12 códigos de identificación DIAN', () => {
    // Se derivan de DIAN_ID_TYPES para no duplicar el catálogo. Si alguien lo
    // amplía, este test obliga a revisar que el DTO deba aceptar el código nuevo.
    expect([...DIAN_IDENTIFICATION_TYPE_CODES].sort()).toEqual(
      ['11', '12', '13', '21', '22', '31', '41', '42', '47', '48', '50', '91'],
    );
  });

  it('rechaza un correo inválido', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_email: 'no-es-un-correo',
    });
    expect(failedPaths(errors)).toContain('customer_email');
  });

  it('trata el correo vacío como "sin correo", no como correo inválido', async () => {
    // El formulario serializa '' cuando el usuario no escribe nada; un 400 por
    // dejar un campo opcional en blanco sería la misma familia de defecto.
    const errors = await validateAsPipe({ ...baseInvoice(), customer_email: '' });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza un dígito de verificación de más de un dígito', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_verification_digit: '77',
    });
    expect(failedPaths(errors)).toContain('customer_verification_digit');
  });

  it('rechaza una responsabilidad fiscal fuera del catálogo RUT', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_fiscal_responsibilities: ['O-13', 'O-99'],
    });
    expect(failedPaths(errors)).toContain('customer_fiscal_responsibilities');
  });

  it.each(['3', '0', 'contado'])(
    'rechaza payment_form inválido (%s)',
    async (payment_form) => {
      const errors = await validateAsPipe({ ...baseInvoice(), payment_form });
      expect(failedPaths(errors)).toContain('payment_form');
    },
  );

  it('rechaza un operation_type fuera del catálogo CustomizationID', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      operation_type: '99',
    });
    expect(failedPaths(errors)).toContain('operation_type');
  });

  it('rechaza un aiu_component inventado', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [
        {
          description: 'Línea AIU',
          quantity: 1,
          unit_price: 1000,
          aiu_component: 'ganancia',
        },
      ],
    });
    expect(failedPaths(errors)).toContain('items.0.aiu_component');
  });

  it.each(['PESOS', 'CO', '$', 'COPX'])(
    'rechaza currency fuera de ISO 4217 (%s)',
    async (currency) => {
      const errors = await validateAsPipe({ ...baseInvoice(), currency });
      expect(failedPaths(errors)).toContain('currency');
    },
  );

  /**
   * La forma no basta. El validador anterior era `/^[A-Z]{3}$/`, que sólo
   * comprobaba «tres mayúsculas»: "ABC" y "ZZZ" pasaban y viajaban al XML como
   * el `@currencyID` de todos los importes.
   */
  it.each(['ABC', 'ZZZ', 'QQQ'])(
    'rechaza un código de 3 letras que no es moneda (%s)',
    async (currency) => {
      const errors = await validateAsPipe({ ...baseInvoice(), currency });
      expect(failedPaths(errors)).toContain('currency');
    },
  );

  /**
   * Estos SÍ están en ISO 4217, así que `@IsISO4217CurrencyCode()` por sí solo
   * los aceptaría — pero no son dinero y no pueden denominar un importe
   * facturado.
   */
  it.each(['XXX', 'XTS', 'XAU', 'XDR'])(
    'rechaza el código ISO 4217 no monetario %s',
    async (currency) => {
      const errors = await validateAsPipe({ ...baseInvoice(), currency });
      expect(failedPaths(errors)).toContain('currency');
    },
  );

  /** Empiezan por X pero son monedas en circulación: no deben caer con XXX. */
  it.each(['XCD', 'XOF', 'XAF', 'XPF'])(
    'acepta la moneda real %s pese a empezar por X',
    async (currency) => {
      const errors = await validateAsPipe({ ...baseInvoice(), currency });
      expect(failedPaths(errors)).toEqual([]);
    },
  );

  it.each(['ABC', 'ZZZ', 'XXX', 'XAU'])(
    'aplica la misma exigencia a foreign_currency (%s)',
    async (foreign_currency) => {
      const errors = await validateAsPipe({
        ...baseInvoice(),
        foreign_currency,
      });
      expect(failedPaths(errors)).toContain('foreign_currency');
    },
  );

  /**
   * `foreign_currency: 'COP'` NO es un error de contrato: la emisión
   * (`InvoiceFlowService.buildExchangeRateDeclaration`) ya lo interpreta como
   * «sin divisa extranjera» y omite `cac:PaymentExchangeRate`. Rechazarlo aquí
   * convertiría en 400 algo que hoy se resuelve solo.
   */
  it('acepta foreign_currency COP y deja que el flujo lo neutralice', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      foreign_currency: 'COP',
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('normaliza la divisa a mayúsculas en vez de rechazarla', async () => {
    const dto = plainToInstance(
      CreateInvoiceDto,
      { ...baseInvoice(), currency: ' cop ' },
      { enableImplicitConversion: true },
    );
    expect(dto.currency).toBe('COP');
    expect(failedPaths(await validate(dto, PIPE_OPTIONS))).toEqual([]);
  });

  it('rechaza una tasa de cambio negativa', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      exchange_rate: -1,
    });
    expect(failedPaths(errors)).toContain('exchange_rate');
  });
});

describe('CreateInvoiceDto — cotas numéricas y de arreglo', () => {
  it('rechaza una factura sin líneas', async () => {
    const errors = await validateAsPipe({ ...baseInvoice(), items: [] });
    expect(failedPaths(errors)).toContain('items');
  });

  it('rechaza una cantidad en cero', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [{ description: 'X', quantity: 0, unit_price: 1000 }],
    });
    expect(failedPaths(errors)).toContain('items.0.quantity');
  });

  it('rechaza una cantidad por debajo de la precisión de la columna', async () => {
    // Decimal(12,4): 0.00001 se redondearía a 0 al persistir.
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [{ description: 'X', quantity: 0.00001, unit_price: 1000 }],
    });
    expect(failedPaths(errors)).toContain('items.0.quantity');
  });

  it('acepta la cantidad mínima representable (0.0001)', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [{ description: 'X', quantity: 0.0001, unit_price: 1000 }],
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza un precio unitario negativo', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [{ description: 'X', quantity: 1, unit_price: -5 }],
    });
    expect(failedPaths(errors)).toContain('items.0.unit_price');
  });

  it('rechaza un descuento negativo', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [
        {
          description: 'X',
          quantity: 1,
          unit_price: 1000,
          discount_amount: -1,
        },
      ],
    });
    expect(failedPaths(errors)).toContain('items.0.discount_amount');
  });

  it('rechaza una descripción vacía', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [{ description: '   ', quantity: 1, unit_price: 1000 }],
    });
    expect(failedPaths(errors)).toContain('items.0.description');
  });

  it('rechaza una tarifa de impuesto de 150%', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [
        {
          description: 'X',
          quantity: 1,
          unit_price: 1000,
          taxes: [
            {
              tax_name: 'IVA absurdo',
              tax_rate: 150,
              taxable_amount: 1000,
              tax_amount: 1500,
            },
          ],
        },
      ],
    });
    expect(failedPaths(errors)).toContain('items.0.taxes.0.tax_rate');
  });

  it('rechaza una base gravable negativa', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      items: [
        {
          description: 'X',
          quantity: 1,
          unit_price: 1000,
          taxes: [
            {
              tax_name: 'IVA 19%',
              tax_rate: 19,
              taxable_amount: -1000,
              tax_amount: 190,
            },
          ],
        },
      ],
    });
    expect(failedPaths(errors)).toContain('items.0.taxes.0.taxable_amount');
  });

  it('rechaza una retención negativa', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      withholding_amount: -1,
    });
    expect(failedPaths(errors)).toContain('withholding_amount');
  });
});

describe('CreateInvoiceDto — ventana fiscal de issue_date', () => {
  it('acepta la fecha de hoy', async () => {
    const errors = await validateAsPipe(baseInvoice());
    expect(failedPaths(errors)).toEqual([]);
  });

  it('acepta una fecha de hace un año', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      issue_date: isoDay(-365),
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza una fecha de 1970 (año tecleado mal)', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      issue_date: '1970-01-01',
    });
    expect(failedPaths(errors)).toContain('issue_date');
  });

  it('rechaza una fecha en 2090', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      issue_date: '2090-01-01',
    });
    expect(failedPaths(errors)).toContain('issue_date');
  });

  it('rechaza una fecha a un mes en el futuro', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      issue_date: isoDay(30),
    });
    expect(failedPaths(errors)).toContain('issue_date');
  });

  it('tolera un día de futuro (desfase de zona horaria)', async () => {
    // `issue_date` llega como fecha-sólo armada en la zona de la tienda; sin
    // esta holgura una factura emitida de noche en Bogotá se rechazaría.
    const errors = await validateAsPipe({
      ...baseInvoice(),
      issue_date: isoDay(1),
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('deja el error de formato a @IsDateString, sin duplicar causa', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      issue_date: 'ayer',
    });
    const issueDateError = errors.find((e) => e.property === 'issue_date');
    expect(issueDateError?.constraints).toHaveProperty('isDateString');
    expect(issueDateError?.constraints).not.toHaveProperty(
      'IsWithinFiscalIssueDateWindow',
    );
  });
});

describe('CreateInvoiceDto — customer_address (string vs objeto)', () => {
  it('eleva un string plano a { address_line } sin devolver 400', async () => {
    // El formulario declara `customer_address: ['']` — un control de texto.
    // Antes de QUI-690 ese string llegaba a la columna Json y se perdía en el
    // XML: `normalizeAddress()` descarta todo lo que no sea objeto.
    const dto = plainToInstance(
      CreateInvoiceDto,
      { ...baseInvoice(), customer_address: '  Cra 43A # 1-50, Medellín  ' },
      { enableImplicitConversion: true },
    );
    expect(dto.customer_address).toBeInstanceOf(InvoiceAddressDto);
    expect(dto.customer_address.address_line).toBe('Cra 43A # 1-50, Medellín');
    expect(dto.customer_address.country_code).toBe('CO');
    expect(failedPaths(await validate(dto, PIPE_OPTIONS))).toEqual([]);
  });

  it('trata la dirección vacía como ausencia de dirección', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_address: '   ',
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('acepta el objeto desglosado completo', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_address: {
        address_line: 'Cra 43A # 1-50',
        city_code: '05001',
        city_name: 'Medellín',
        department_code: '05',
        department_name: 'Antioquia',
        country_code: 'CO',
        postal_code: '050021',
      },
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza un código DANE de municipio que no son 5 dígitos', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_address: { address_line: 'Cra 43A', city_code: 'Medellín' },
    });
    expect(failedPaths(errors)).toContain('customer_address.city_code');
  });

  it('rechaza un objeto de dirección sin address_line', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_address: { city_code: '05001', city_name: 'Medellín' },
    });
    expect(failedPaths(errors)).toContain('customer_address.address_line');
  });

  it('rechaza una clave no declarada dentro de la dirección', async () => {
    // `forbidNonWhitelisted` también aplica a los objetos anidados: el `any`
    // anterior era la única puerta por la que entraba cualquier forma.
    const errors = await validateAsPipe({
      ...baseInvoice(),
      customer_address: { address_line: 'Cra 43A', barrio: 'Laureles' },
    });
    expect(whitelistOrphans(errors)).toContain('customer_address.barrio');
  });
});

/* -------------------------------------------------------------------------- */
/* Fase F — piso de las llaves foráneas numéricas                              */
/* -------------------------------------------------------------------------- */

/**
 * POR QUÉ ESTE BLOQUE
 * -------------------
 * Siete llaves foráneas del documento estaban declaradas `@IsNumber()` a secas.
 * Eso NO es una compuerta de signo: el `ValidationPipe` global corre con
 * `transform: true` y `transformOptions.enableImplicitConversion: true`
 * (`apps/backend/src/main.ts`), así que la cadena `"-5000"` se coerciona a
 * `-5000` y se aprueba, y el `0` —lo que serializa un formulario a medio
 * llenar— también. El id imposible entraba al servicio como número válido y el
 * fallo aparecía más abajo: un 404 por la razón equivocada, o un 500 sobre lo
 * que era una petición mal formada.
 *
 * `profile_id` ya llevaba `@Min(1)` con esa razón escrita en su docblock, en el
 * MISMO archivo. La asimetría no era entre archivos: era entre campos vecinos.
 *
 * Cada llave se prueba con `0`, con `-1` y con la cadena `"-5000"`, y se
 * comprueba que el `1` sigue pasando —un piso mal puesto que rechace el id
 * válido es peor que no tener piso—.
 */
type ForeignKeyCase = {
  /** Nombre del campo, tal como debe aparecer en el mensaje de error. */
  field: string;
  /** Ruta del error en el árbol de validación. */
  path: string;
  /** Payload completo con ese campo puesto al valor bajo prueba. */
  build: (value: unknown) => Record<string, unknown>;
};

const itemWith = (extra: Record<string, unknown>) => ({
  ...baseInvoice(),
  items: [
    { description: 'Servicio', quantity: 1, unit_price: 1000, ...extra },
  ],
});

const FOREIGN_KEY_CASES: readonly ForeignKeyCase[] = [
  {
    field: 'customer_id',
    path: 'customer_id',
    build: (customer_id) => ({ ...baseInvoice(), customer_id }),
  },
  {
    field: 'supplier_id',
    path: 'supplier_id',
    build: (supplier_id) => ({ ...baseInvoice(), supplier_id }),
  },
  {
    field: 'related_invoice_id',
    path: 'related_invoice_id',
    build: (related_invoice_id) => ({ ...baseInvoice(), related_invoice_id }),
  },
  {
    field: 'resolution_id',
    path: 'resolution_id',
    build: (resolution_id) => ({ ...baseInvoice(), resolution_id }),
  },
  {
    field: 'product_id',
    path: 'items.0.product_id',
    build: (product_id) => itemWith({ product_id }),
  },
  {
    field: 'product_variant_id',
    path: 'items.0.product_variant_id',
    build: (product_variant_id) => itemWith({ product_variant_id }),
  },
  {
    field: 'tax_rate_id',
    path: 'items.0.taxes.0.tax_rate_id',
    build: (tax_rate_id) =>
      itemWith({
        taxes: [{ tax_name: 'IVA 19%', tax_rate: 19, tax_rate_id }],
      }),
  },
];

describe('CreateInvoiceDto — las 7 llaves foráneas tienen piso', () => {
  it('el inventario del spec cubre exactamente las 7 llaves de la fase F', () => {
    // Si mañana nace una FK y nadie la añade acá, el test de metadatos de más
    // abajo la delata igual; esta aserción es el cinturón de este bloque.
    expect(FOREIGN_KEY_CASES.map((c) => c.field).sort()).toEqual([
      'customer_id',
      'product_id',
      'product_variant_id',
      'related_invoice_id',
      'resolution_id',
      'supplier_id',
      'tax_rate_id',
    ]);
  });

  for (const testCase of FOREIGN_KEY_CASES) {
    describe(testCase.field, () => {
      it.each([0, -1])('rechaza el id %s', async (value) => {
        const errors = await validateAsPipe(testCase.build(value));
        expect(failedPaths(errors)).toContain(testCase.path);
      });

      it('rechaza la cadena "-5000", que @IsNumber por sí solo aprueba', async () => {
        // Con `enableImplicitConversion` la cadena se coerciona a -5000 y pasa
        // el chequeo de tipo. Que el mensaje sea el del PISO —y no el de tipo—
        // es la prueba de que el que rechaza es @Min, no @IsNumber.
        const errors = await validateAsPipe(testCase.build('-5000'));
        expect(failedPaths(errors)).toContain(testCase.path);
        expect(messagesAt(errors, testCase.path)).toContain('el mínimo es 1');
      });

      it('sigue aceptando el id 1', async () => {
        const errors = await validateAsPipe(testCase.build(1));
        expect(failedPaths(errors)).toEqual([]);
      });

      // F.5 — decimal ≥ 1: @Min(1) por sí solo lo APRUEBA (1.5 ≥ 1), así que
      // sólo @IsInt lo detiene. Si alguien borra el @IsInt de este campo, este
      // caso —y sólo este— empieza a pasar donde antes fallaba: es la prueba
      // de mutación que demuestra que el decorador hace algo.
      it('rechaza el id decimal 1.5 (F.5 — @IsInt, @Min por sí solo lo aprueba)', async () => {
        const errors = await validateAsPipe(testCase.build(1.5));
        expect(failedPaths(errors)).toContain(testCase.path);
        expect(messagesAt(errors, testCase.path)).toContain('entero');
      });

      it('el mensaje nombra el campo y su límite', async () => {
        const errors = await validateAsPipe(testCase.build(0));
        const message = messagesAt(errors, testCase.path);
        expect(message).toContain(testCase.field);
        expect(message).toContain('el mínimo es 1');
      });
    });
  }

  /**
   * La compuerta que sobrevive al próximo campo. Enumera los metadatos reales
   * de class-validator en las tres clases y exige que TODA propiedad declarada
   * `@IsNumber`/`@IsInt` lleve además un `min`.
   *
   * Cubre las 7 llaves foráneas y, de paso, todo campo monetario: un importe
   * `@IsNumber` sin piso acepta la cadena `"-5000"` por la misma puerta.
   */
  const DTO_CLASSES: Record<string, ClassConstructor<object>> = {
    CreateInvoiceDto,
    CreateInvoiceItemDto,
    CreateInvoiceTaxDto,
  };

  /**
   * Cuántas propiedades `@IsNumber` tiene cada clase HOY. Medido, no estimado:
   * 9 + 6 + 4 = 19 (C.7 sumó `aiu_minimum_base_percent` a `CreateInvoiceDto`,
   * con su propio `@Min`/`@Max`). Existe para que la compuerta no pueda pasar
   * en vacío — si la lectura de metadatos se rompe y devuelve cero
   * propiedades, esto falla antes de que el «no hay ninguna sin piso» mienta.
   * Y si nace un campo numérico, obliga a actualizar el número a conciencia.
   */
  const NUMERIC_PROPERTY_COUNT: Record<string, number> = {
    CreateInvoiceDto: 9,
    CreateInvoiceItemDto: 6,
    CreateInvoiceTaxDto: 4,
  };

  it.each(Object.keys(DTO_CLASSES))(
    'ninguna propiedad numérica de %s queda sin piso',
    (name) => {
      const byProperty = constraintNamesByProperty(DTO_CLASSES[name]);
      const numeric = [...byProperty.entries()].filter(
        ([, names]) => names.has('isNumber') || names.has('isInt'),
      );

      expect(numeric.map(([property]) => property).sort()).toHaveLength(
        NUMERIC_PROPERTY_COUNT[name],
      );

      const floorless = numeric
        .filter(([, names]) => !names.has('min'))
        .map(([property]) => property)
        .sort();

      if (floorless.length > 0) {
        throw new Error(
          `${name} declara ${floorless.length} propiedad(es) numérica(s) sin ` +
            `@Min: ${floorless.join(', ')}.\n\n` +
            `El ValidationPipe global corre con enableImplicitConversion, así ` +
            `que @IsNumber() NO es una compuerta de signo: aprueba la cadena ` +
            `"-5000" y aprueba el 0. En una llave foránea eso entra al ` +
            `servicio como id válido y sale como 404 por la razón equivocada o ` +
            `como 500 sobre una petición mal formada; en un importe, como un ` +
            `total negativo. Declara @Min con un mensaje que nombre el campo y ` +
            `el límite — el patrón está en foreignKeyFloorMessage.`,
        );
      }
      expect(floorless).toEqual([]);
    },
  );
});

/* -------------------------------------------------------------------------- */
/* Fase F — cotas de longitud citadas del Anexo Técnico DIAN 1.9               */
/* -------------------------------------------------------------------------- */

const chars = (n: number): string => 'A'.repeat(n);

describe('CreateInvoiceDto — notes: cota FAD13 (/Invoice/cbc:Note, 1-500)', () => {
  it('acepta exactamente 500 caracteres', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      notes: chars(500),
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza 501 caracteres', async () => {
    // Era la ÚNICA propiedad de texto del DTO sin cota alguna, y la columna
    // `invoices.notes` es `text` sin límite: nada ataja el texto largo antes de
    // que viaje al XML. La DIAN devuelve el documento al validar, con el
    // consecutivo autorizado ya gastado.
    const errors = await validateAsPipe({
      ...baseInvoice(),
      notes: chars(501),
    });
    expect(failedPaths(errors)).toContain('notes');
  });

  it('el mensaje nombra el campo, el tope y la regla del anexo', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      notes: chars(501),
    });
    const message = messagesAt(errors, 'notes');
    expect(message).toContain('notes');
    expect(message).toContain('500');
    expect(message).toContain('FAD13');
  });
});

describe('CreateInvoiceItemDto — unit_code: cota FAV05 (@unitCode, 1-5)', () => {
  it.each(['NIU', 'KGM', 'LTR', '94'])(
    'acepta el código UN/ECE rec. 20 %s',
    async (unit_code) => {
      const errors = await validateAsPipe(itemWith({ unit_code }));
      expect(failedPaths(errors)).toEqual([]);
    },
  );

  it('acepta exactamente 5 caracteres', async () => {
    const errors = await validateAsPipe(itemWith({ unit_code: chars(5) }));
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza 6 caracteres', async () => {
    // El tope anterior era 10 y no citaba ninguna regla: dejaba pasar 6 a 10
    // caracteres que la DIAN devuelve al validar la línea. FAV05, CAV05 y
    // DAV05 coinciden en 5, así que no hay conflicto entre tipos de documento.
    const errors = await validateAsPipe(itemWith({ unit_code: chars(6) }));
    expect(failedPaths(errors)).toContain('items.0.unit_code');
  });

  it('el mensaje nombra el campo, el tope y la regla del anexo', async () => {
    const errors = await validateAsPipe(itemWith({ unit_code: chars(6) }));
    const message = messagesAt(errors, 'items.0.unit_code');
    expect(message).toContain('unit_code');
    expect(message).toContain('5');
    expect(message).toContain('FAV05');
  });
});

/**
 * F.6 — el Anexo Técnico 1.9 fija DOS topes distintos para
 * `cac:InvoiceLine/cbc:Description` según el documento padre: factura
 * (FAZ02) 1-300, nota crédito (CAZ02) 1-600. `CreateInvoiceItemDto.description`
 * tenía un único `@MaxLength(500)` que no era correcto para NINGUNO de los
 * dos: dejaba pasar 301-500 en factura (que la DIAN rechaza al emitir, ya con
 * el consecutivo gastado) y no alcanzaba los 600 legales de nota crédito.
 *
 * `CreateInvoiceDto.items` usa ahora `CreateFacturaInvoiceItemDto`
 * (`@Type(() => CreateFacturaInvoiceItemDto)`), que sobreescribe SÓLO
 * `@MaxLength` a 300. Nota crédito/débito siguen en `CreateInvoiceItemDto`
 * —techo común de 500, limitado por la columna `invoice_items.description`,
 * no por la ley— porque su legal (600) excede esa columna y ensancharla es
 * una migración de `schema.prisma` fuera de este alcance.
 */
describe('CreateFacturaInvoiceItemDto — description: cota FAZ02 (cac:InvoiceLine/cbc:Description, 1-300)', () => {
  it('acepta exactamente 300 caracteres', async () => {
    const errors = await validateAsPipe(itemWith({ description: chars(300) }));
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza 301 caracteres con 400 (vía ValidationPipe)', async () => {
    const errors = await validateAsPipe(itemWith({ description: chars(301) }));
    expect(failedPaths(errors)).toContain('items.0.description');
  });

  it('el mensaje nombra el campo, el tope y la regla FAZ02', async () => {
    const errors = await validateAsPipe(itemWith({ description: chars(301) }));
    const message = messagesAt(errors, 'items.0.description');
    expect(message).toContain('300');
    expect(message).toContain('FAZ02');
  });

  it('301-500 caracteres, que el techo COMÚN (500) aprobaría, sigue rechazado en factura', async () => {
    // Es exactamente el hueco que F.6 cierra: antes de la subclase, 301-500
    // pasaba `CreateInvoiceItemDto.description` (500) y sólo se descubría al
    // emitir, con el consecutivo ya gastado.
    const errors = await validateAsPipe(itemWith({ description: chars(450) }));
    expect(failedPaths(errors)).toContain('items.0.description');
  });
});

/**
 * C.7 — DESCONGELAR LOS TRES CONTROLES AIU DEL DOCUMENTO.
 *
 * Antes de este paso el DTO no declaraba `aiu_taxable_basis`,
 * `aiu_enforce_minimum_base` ni `aiu_minimum_base_percent`: con
 * `forbidNonWhitelisted: true` (`main.ts:206`), el frontend no podía siquiera
 * ENVIAR un apartamiento del perfil sin recibir 400. Este bloque cubre sólo el
 * FORMATO — la legalidad de negocio (base↔matriz, piso vs. legal) se prueba en
 * `invoicing.service.aiu-document-overrides.spec.ts`, contra la escritura real
 * del documento.
 */
describe('CreateInvoiceDto — C.7: controles AIU apartables por documento', () => {
  it('acepta los tres controles juntos', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      operation_type: '09',
      aiu_taxable_basis: 'subtotal',
      aiu_enforce_minimum_base: false,
      aiu_minimum_base_percent: 12.5,
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('ausentes los tres, el documento valida igual que antes de C.7', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      operation_type: '09',
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it.each([['aiu'], ['utilidad'], ['subtotal']])(
    'acepta aiu_taxable_basis %s',
    async (basis) => {
      const errors = await validateAsPipe({
        ...baseInvoice(),
        aiu_taxable_basis: basis,
      });
      expect(failedPaths(errors)).toEqual([]);
    },
  );

  it('rechaza un aiu_taxable_basis fuera de aiu/utilidad/subtotal', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      aiu_taxable_basis: 'total',
    });
    expect(failedPaths(errors)).toContain('aiu_taxable_basis');
  });

  it('trata aiu_taxable_basis vacío como "sin valor", no como valor inválido', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      aiu_taxable_basis: '',
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it.each([[true], [false]])(
    'acepta aiu_enforce_minimum_base %s',
    async (value) => {
      const errors = await validateAsPipe({
        ...baseInvoice(),
        aiu_enforce_minimum_base: value,
      });
      expect(failedPaths(errors)).toEqual([]);
    },
  );

  it('rechaza aiu_enforce_minimum_base que no es booleano', async () => {
    // Un string u objeto escalar NO sirve como contraejemplo: con
    // `enableImplicitConversion: true` (el pipe global), class-transformer
    // convierte cualquier escalar truthy a `true` ANTES de que `@IsBoolean()`
    // corra — 'sí', 42 y {} los tres llegan como `true`. Un arreglo es lo
    // único que sobrevive la conversión implícita sin volverse booleano.
    const errors = await validateAsPipe({
      ...baseInvoice(),
      aiu_enforce_minimum_base: [],
    });
    expect(failedPaths(errors)).toContain('aiu_enforce_minimum_base');
  });

  it('acepta aiu_minimum_base_percent dentro de 0-100', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      aiu_minimum_base_percent: 10,
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza aiu_minimum_base_percent negativo', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      aiu_minimum_base_percent: -1,
    });
    expect(failedPaths(errors)).toContain('aiu_minimum_base_percent');
  });

  it('rechaza aiu_minimum_base_percent por encima de 100', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      aiu_minimum_base_percent: 100.01,
    });
    expect(failedPaths(errors)).toContain('aiu_minimum_base_percent');
  });
});

describe('CreateInvoiceDto — D.7: la compuerta del Modelo 1 está abierta', () => {
  /**
   * `aiu_accounting_model` valida contra `ENABLED_ACCOUNTING_MODELS`, el mismo
   * interruptor único que gobierna la escritura del perfil. La apertura del
   * Modelo 1 (2026-08-25, autorización explícita del dueño) añadió
   * `'no_sumada'` a esa lista y ESTE spec es el que fija que la puerta del
   * documento se levantó con ella — no sólo la del perfil.
   */
  it.each([['sumada'], ['no_sumada']])(
    'acepta aiu_accounting_model %s',
    async (model) => {
      const errors = await validateAsPipe({
        ...baseInvoice(),
        aiu_accounting_model: model,
      });
      expect(failedPaths(errors)).toEqual([]);
    },
  );

  it('rechaza un modelo que no existe, nombrando los dos admitidos', async () => {
    const errors = await validateAsPipe({
      ...baseInvoice(),
      aiu_accounting_model: 'mitad_y_mitad',
    });
    expect(failedPaths(errors)).toContain('aiu_accounting_model');
    expect(messagesAt(errors, 'aiu_accounting_model')).toContain(
      'sumada, no_sumada',
    );
  });
});
