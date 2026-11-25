import { servicePageFacts } from '../../../../../../public/app-page/app-page-conditions';
import { bookingLabel } from '../../../../../../public/service-page/service-page.util';
import type { AppPageDocument } from '../../templates';
import { SERVICE_PAGE_BUILDER_CATALOG, ServicePageContext, selectPreviewServices, servicePagePreview } from './service-page-builder';

const svc = (id: number, name: string, over: Partial<ServicePageContext['services'][number]> = {}) => ({
  id,
  slug: `s-${id}`,
  name,
  description: null,
  price: 50000,
  final_price: 59500,
  image_url: null,
  service_duration_minutes: 60,
  service_duration_unit: null,
  service_modality: 'in_person',
  requires_booking: true,
  categories: [],
  ...over,
});

const withServices = (props: Record<string, unknown>): AppPageDocument => ({
  schema_version: 1,
  blocks: [{ id: 'services', type: 'services', enabled: true, props }],
});

/** Apps booking-detail — la vista previa elige los servicios con la misma regla que el servidor. */
describe('selectPreviewServices', () => {
  const store = [svc(1, 'Corte'), svc(2, 'Tinte'), svc(3, 'Manicure')];

  it('manual: solo los elegidos, en su orden, entre los servicios en línea de la tienda', () => {
    const out = selectPreviewServices(store, [2], withServices({ selection: 'manual', service_ids: [3, 99, 1] }));
    expect(out.services.map((s) => s.id)).toEqual([3, 1]);
    expect(out.featuredIds).toEqual([]);
  });

  it('auto (o sin selección) ignora los service_ids guardados: destacados primero y el resto por nombre', () => {
    const out = selectPreviewServices(store, [2], withServices({ selection: 'auto', service_ids: [3] }));
    expect(out.services.map((s) => s.id)).toEqual([2, 1, 3]);
    expect(selectPreviewServices(store, [], null).services.map((s) => s.id)).toEqual([1, 3, 2]);
  });

  it('con más de 60 servicios, el tope de 60 aplica solo a automático y manual incluye servicios por encima de 60', () => {
    const many = Array.from({ length: 65 }, (_, i) => svc(i + 1, `Servicio ${String(i + 1).padStart(2, '0')}`));
    expect(selectPreviewServices(many, [], withServices({ selection: 'auto' })).services.length).toBe(60);
    const manual = selectPreviewServices(many, [], withServices({ selection: 'manual', service_ids: [65, 62, 65] }));
    expect(manual.services.map((s) => s.id)).toEqual([65, 62]);
  });
});

describe('servicePagePreview', () => {
  it('pinta el precio final del servidor, la unidad de duración e is_plan para paridad con público', () => {
    const preview = servicePagePreview({
      kind: 'service_page',
      page: withServices({ selection: 'manual', service_ids: [2, 3] }),
      storeName: 'Spa',
      storeLogoUrl: null,
      settings: { featured: [], products: [] },
      context: {
        services: [
          svc(1, 'Corte'),
          svc(2, 'Tinte', { final_price: 71400, service_duration_unit: 'hour', is_plan: false }),
          svc(3, 'Plan 3 días', { final_price: 119000, requires_booking: true, is_plan: true }),
        ],
        featured_service_ids: [],
        products: [],
      },
    } as never);
    expect(preview.services.map((s) => [s.id, s.final_price, s.service_duration_unit, s.is_plan])).toEqual([
      [2, 71400, 'hour', false],
      [3, 119000, null, true],
    ]);
    expect(bookingLabel(preview.services[0], true)).toBe('Reservar');
    expect(bookingLabel(preview.services[1], true)).toBe('Ver plan');
    // Un catálogo con solo un plan tiene has_availability = false igual que el público.
    expect(servicePageFacts([preview.services[1]], true).has_availability).toBeFalse();
  });

  it('el bloque services define defaultProps explícitos coherentes con la vista previa', () => {
    const def = SERVICE_PAGE_BUILDER_CATALOG.blocks.find((b) => b.type === 'services');
    expect(def?.defaultProps).toEqual({ show_duration: true, show_price: true });
  });
});
