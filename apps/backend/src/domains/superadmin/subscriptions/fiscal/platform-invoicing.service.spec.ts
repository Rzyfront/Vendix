import { PlatformInvoicingService } from './platform-invoicing.service';

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
