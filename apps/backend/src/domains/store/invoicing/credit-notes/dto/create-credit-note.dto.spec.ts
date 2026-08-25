import 'reflect-metadata';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError, ValidatorOptions } from 'class-validator';
import { CreateCreditNoteDto, CreateDebitNoteDto } from './create-credit-note.dto';

/**
 * F.6 — el Anexo Técnico DIAN 1.9 fija DOS topes distintos para
 * `cbc:Description` de línea según el documento padre: factura (FAZ02)
 * 1-300, nota crédito (CAZ02) 1-600. `CreateInvoiceItemDto.description`
 * llevaba un único `@MaxLength(500)` compartido por los tres DTOs
 * (`CreateInvoiceDto`, `CreateCreditNoteDto`, `CreateDebitNoteDto`), que no
 * era correcto para ninguno de los dos legales.
 *
 * Este spec cubre el lado de NOTA: a diferencia de factura —que ahora usa
 * `CreateFacturaInvoiceItemDto` con `@MaxLength(300)`—, nota crédito/débito
 * siguen en la clase base (techo 500). Ese 500 es el ancho REAL de la columna
 * `invoice_items.description` en la base de datos, no el legal completo (600,
 * CAZ02): subirlo a 600 requiere ensanchar esa columna, una migración de
 * `schema.prisma` fuera del alcance de esta sesión. 500 es seguro mientras
 * tanto — nunca deja pasar más de lo que la columna admite, y sigue por
 * ENCIMA del tope de factura (300), que es lo que demuestra el primer bloque.
 *
 * También cubre `notes` (reglas CAD11/DAD11, 1-5000), que viajaba SIN ningún
 * `@MaxLength` antes de F.6.
 */

const PIPE_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

const chars = (n: number): string => 'A'.repeat(n);

const validateAsPipe = async (
  target: ClassConstructor<object>,
  payload: Record<string, unknown>,
): Promise<ValidationError[]> => {
  const instance = plainToInstance(target, payload, {
    enableImplicitConversion: true,
  });
  return validate(instance, PIPE_OPTIONS);
};

const failedPaths = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own = error.constraints ? [path] : [];
    return [...own, ...failedPaths(error.children ?? [], path)];
  });

const messagesAt = (errors: ValidationError[], path: string): string => {
  const segments = path.split('.');
  let level = errors;
  let node: ValidationError | undefined;
  for (const segment of segments) {
    node = level.find((error) => error.property === segment);
    if (!node) return '';
    level = node.children ?? [];
  }
  return node?.constraints ? Object.values(node.constraints).join(' ') : '';
};

const baseNote = (): Record<string, unknown> => ({ related_invoice_id: 1 });

describe.each([
  ['CreateCreditNoteDto', CreateCreditNoteDto],
  ['CreateDebitNoteDto', CreateDebitNoteDto],
])('%s — items[].description: techo compartido (nota, no factura)', (_name, cls) => {
  it('acepta 301 caracteres — por encima del tope de factura (FAZ02, 300)', async () => {
    // Es exactamente la diferencia que F.6 introduce: 301 caracteres es
    // ilegal en una LÍNEA DE FACTURA (rechazado por CreateFacturaInvoiceItemDto)
    // pero perfectamente válido en una nota, cuyo legal (CAZ02/DAZ02) es mayor.
    const errors = await validateAsPipe(cls, {
      ...baseNote(),
      items: [{ description: chars(301), quantity: 1, unit_price: 1000 }],
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('acepta exactamente 500 caracteres — el ancho real de la columna', async () => {
    const errors = await validateAsPipe(cls, {
      ...baseNote(),
      items: [{ description: chars(500), quantity: 1, unit_price: 1000 }],
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza 501 caracteres: la columna invoice_items.description no da para más', async () => {
    const errors = await validateAsPipe(cls, {
      ...baseNote(),
      items: [{ description: chars(501), quantity: 1, unit_price: 1000 }],
    });
    expect(failedPaths(errors)).toContain('items.0.description');
  });
});

describe.each([
  ['CreateCreditNoteDto', CreateCreditNoteDto],
  ['CreateDebitNoteDto', CreateDebitNoteDto],
])('%s — notes: cota CAD11/DAD11 (cbc:Note, 1-5000)', (_name, cls) => {
  it('acepta exactamente 5000 caracteres', async () => {
    const errors = await validateAsPipe(cls, {
      ...baseNote(),
      notes: chars(5000),
    });
    expect(failedPaths(errors)).toEqual([]);
  });

  it('rechaza 5001 caracteres', async () => {
    const errors = await validateAsPipe(cls, {
      ...baseNote(),
      notes: chars(5001),
    });
    expect(failedPaths(errors)).toContain('notes');
  });

  it('el mensaje nombra el campo, el tope y las reglas del anexo', async () => {
    const errors = await validateAsPipe(cls, {
      ...baseNote(),
      notes: chars(5001),
    });
    const message = messagesAt(errors, 'notes');
    expect(message).toContain('notes');
    expect(message).toContain('5000');
    expect(message).toMatch(/CAD11|DAD11/);
  });

  it('sigue siendo opcional: ausente no falla', async () => {
    const errors = await validateAsPipe(cls, baseNote());
    expect(failedPaths(errors)).toEqual([]);
  });
});
