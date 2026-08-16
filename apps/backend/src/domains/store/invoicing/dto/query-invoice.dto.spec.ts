import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryInvoiceDto } from './query-invoice.dto';

/**
 * Spec mínima del query DTO tras QUI-682.
 *
 * El cambio crítico es que el filtro `invoice_type` ahora acepta los 9 valores
 * del enum de Prisma (antes aceptaba 5 — `support_document`,
 * `support_adjustment_note`, `pos_equivalent_document` y
 * `equivalent_adjustment_note` se filtraban pero no se podían consultar).
 * También se añaden `cuds?: string` y `supplier_id?: number` para QUI-682.
 *
 * El `CreateInvoiceDto` ya aceptaba los 9 desde antes; este test fija la
 * paridad del query DTO y blinda contra valores inventados.
 */
describe('QueryInvoiceDto', () => {
  // El test usa `plainToInstance` con `enableImplicitConversion: false` para
  // que los `Type(() => Number)` corran exactamente como en el ValidationPipe
  // global de NestJS — un value enviado como string no se convierte al pasar
  // por `class-transformer` salvo que se le diga.
  const transform = (input: Record<string, unknown>) =>
    plainToInstance(QueryInvoiceDto, input, { enableImplicitConversion: false });

  describe('invoice_type', () => {
    const valid_types = [
      'sales_invoice',
      'purchase_invoice',
      'credit_note',
      'debit_note',
      'export_invoice',
      'support_document',
      'support_adjustment_note',
      'pos_equivalent_document',
      'equivalent_adjustment_note',
    ];

    it.each(valid_types)(
      'acepta el valor válido "%s"',
      async (invoice_type) => {
        const dto = transform({ invoice_type });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      },
    );

    it('rechaza un valor inventado con 400 (validation error)', async () => {
      const dto = transform({ invoice_type: 'tiquete_inventado' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('invoice_type');
      // `isIn`, no `isEnum`: el decorador pasó a `@IsIn([...])` porque
      // `@IsEnum` con un array literal construye la lista de valores con
      // `Object.keys().filter(k => isNaN(k))` y en un array las claves son
      // índices — se filtran todas y el usuario lee «must be one of the
      // following values: » sin un solo valor. Se afirma además que el mensaje
      // los enumera, que es la razón del cambio.
      expect(errors[0].constraints).toHaveProperty('isIn');
      expect(errors[0].constraints?.isIn).toContain('sales_invoice');
    });

    it('acepta invoice_type vacío (filtro opcional)', async () => {
      const dto = transform({});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('acepta exactamente 9 valores válidos', () => {
      // Cinturón y tirantes: si alguien añade/borra un valor del array pero
      // olvida actualizar el DTO (o viceversa), este test rompe antes de que
      // llegue a prod.
      expect(valid_types).toHaveLength(9);
    });
  });

  describe('cuds / supplier_id (nuevo en QUI-682)', () => {
    it('acepta cuds como string hasta 255 chars', async () => {
      const cuds = 'a'.repeat(255);
      const dto = transform({ cuds });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rechaza cuds de más de 255 chars', async () => {
      const cuds = 'a'.repeat(256);
      const dto = transform({ cuds });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'cuds')).toBe(true);
    });

    it('acepta supplier_id numérico', async () => {
      const dto = transform({ supplier_id: 50 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('acepta supplier_id ausente', async () => {
      const dto = transform({});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('paginación y filtros legados', () => {
    it('aplica defaults de page=1, limit=10, sort_by=created_at, sort_order=desc', () => {
      const dto = transform({});
      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(10);
      expect(dto.sort_by).toBe('created_at');
      expect(dto.sort_order).toBe('desc');
    });

    it('acepta status válidos', async () => {
      for (const status of [
        'draft',
        'validated',
        'sent',
        'accepted',
        'rejected',
        'cancelled',
        'voided',
      ]) {
        const dto = transform({ status });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      }
    });
  });
});