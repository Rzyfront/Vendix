import { PlatformInvoicingService } from './platform-invoicing.service';
import { computeNitDv } from '../../../../common/utils/nit.util';

/**
 * Step 8 (order-truth-and-invoice-tz-plan.md) — `mapToStoreCreateInvoiceDto`
 * fechaba la factura con `new Date().toISOString().slice(0, 10)`: fecha
 * civil de UTC, no la de la plataforma (`PLATFORM_TIMEZONE`). Ahora usa
 * `localDateString(new Date(), PLATFORM_TIMEZONE)`.
 *
 * `mapToStoreCreateInvoiceDto` sólo depende de otros métodos PUROS de la
 * misma clase (`mapTenantToCustomerFields`, `mapLineToStoreLine`,
 * `taxNameCatalog`) — ninguno toca `this.prisma` ni ningún servicio
 * inyectado. `Object.create(PlatformInvoicingService.prototype)` evita
 * tener que mockear los 8 constructor params de la fachada (patrón ya usado
 * en `dian-signing-instant.spec.ts` para `DianDirectProvider`).
 */
describe('PlatformInvoicingService.mapToStoreCreateInvoiceDto — fecha en zona de plataforma', () => {
  const service = Object.create(PlatformInvoicingService.prototype) as any;

  const validTenant = {
    kind: 'store',
    id: 1,
    legal_name: 'Tenant Demo SAS',
    tax_id: '900123456',
    tax_id_dv: '1',
  };

  it('fecha la factura con la fecha civil de HOY en la zona de la plataforma (YYYY-MM-DD)', () => {
    const dto = service.mapToStoreCreateInvoiceDto({ items: [] }, validTenant);

    // PLATFORM_TIMEZONE === DEFAULT_STORE_TIMEZONE (America/Bogota, UTC-5).
    // Cerca de medianoche UTC el día civil en Bogotá puede ir un día detrás
    // del de UTC — por eso se compara contra el mismo cálculo, no contra
    // `new Date().toISOString().slice(0, 10)` (el bug que este test cierra).
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    expect(dto.issue_date).toBe(expected);
    expect(dto.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('PlatformInvoicingService — identidad del cliente externo (release 921)', () => {
  const upsert = jest.fn();
  const createPlatformInvoice = jest.fn();
  let service: PlatformInvoicingService;

  beforeEach(() => {
    jest.clearAllMocks();
    upsert.mockResolvedValue({ id: 1 });
    createPlatformInvoice.mockResolvedValue({
      transmission_id: 10,
      fiscal_number: 'FV10',
      accepted: true,
      transmission_status: 'accepted',
      dian_status: 'accepted',
      cufe: 'cufe',
      error_message: null,
    });
    service = new PlatformInvoicingService(
      { platform_customers: { upsert } } as never,
      null as never,
      null as never,
      null as never,
      null as never,
      { createPlatformInvoice } as never,
      null as never,
      null as never,
      null as never,
    );
  });

  const emit = (customer: Record<string, unknown>) => service.createSalesInvoice({
    organizationId: 1,
    accountingEntityId: 1,
    dianConfigurationId: 1,
    actorUserId: 1,
    dto: {
      customer: {
        kind: 'external',
        legal_name: 'Adquiriente SAS',
        tax_id: '900123456',
        email: 'compras@adquiriente.co',
        ...customer,
      },
      items: [{ description: 'Suscripción', quantity: 1, unit_price: 100 }],
    },
  });

  it.each(['900.123.456-8', ' 900123456 ', '900123456-0'])(
    'normaliza %s a la misma clave y calcula DV, nunca usa el digitado ni default 0',
    async (tax_id) => {
      await emit({ tax_id });
      expect(upsert.mock.calls[0][0]).toMatchObject({
        where: { document_type_tax_id: { document_type: '31', tax_id: '900123456' } },
        create: { tax_id: '900123456', tax_id_dv: computeNitDv('900123456') },
        update: { tax_id_dv: computeNitDv('900123456') },
      });
      expect(createPlatformInvoice.mock.calls[0][0].customer).toMatchObject({
        tax_id: '900123456',
        tax_id_dv: computeNitDv('900123456'),
      });
    },
  );

  it('CC de diez dígitos no pierde su último dígito y no exige ni persiste DV', async () => {
    await emit({ tax_id: '1.020.304.050', document_type: 'CC', tax_id_dv: '0' });
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { document_type_tax_id: { document_type: '13', tax_id: '1020304050' } },
      create: { tax_id: '1020304050', tax_id_dv: null },
    });
    expect(createPlatformInvoice.mock.calls[0][0].customer).toMatchObject({
      document_type: '13', tax_id: '1020304050', tax_id_dv: '',
    });
  });

  it('los defaults para emitir no sobrescriben campos fiscales buenos no elegidos', async () => {
    await emit({});
    const { create, update } = upsert.mock.calls[0][0];
    expect(create).toMatchObject({
      person_type: '2', tax_regime_code: '49', fiscal_responsibilities: ['R-99-PN'],
    });
    expect(update).not.toHaveProperty('person_type');
    expect(update).not.toHaveProperty('tax_regime_code');
    expect(update).not.toHaveProperty('fiscal_responsibilities');
    expect(update).not.toHaveProperty('phone');
    expect(update).not.toHaveProperty('address_line');
  });

  it('persiste los campos fiscales cuando el operador sí los eligió', async () => {
    await emit({
      person_type: '1', tax_regime_code: '48', fiscal_responsibilities: ['O-48', 'O-13'],
    });
    expect(upsert.mock.calls[0][0].update).toMatchObject({
      person_type: '1', tax_regime_code: '48', fiscal_responsibilities: ['O-48', 'O-13'],
    });
  });

  it('no borra valores opcionales guardados con cadenas o listas vacías', async () => {
    await emit({
      person_type: '', tax_regime_code: '  ', fiscal_responsibilities: [],
      phone: '', address: { line: ' ' },
    });
    const { update } = upsert.mock.calls[0][0];
    for (const field of [
      'person_type', 'tax_regime_code', 'fiscal_responsibilities', 'phone', 'address_line',
    ]) expect(update).not.toHaveProperty(field);
  });

  it('rechaza documento sin dígitos antes de emitir o recordar el cliente', async () => {
    await expect(emit({ tax_id: '...- ' })).rejects.toMatchObject({
      errorCode: 'SYS_VALIDATION_001',
    });
    expect(createPlatformInvoice).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
