import type { AppPageDocument } from '../../templates';
import { ServicePageContext, selectPreviewServices, servicePagePreview } from './service-page-builder';

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
});

describe('servicePagePreview', () => {
  it('pinta el precio final del servidor (el del catálogo público) y la unidad de duración', () => {
    const preview = servicePagePreview({
      kind: 'service_page',
      page: withServices({ selection: 'manual', service_ids: [2] }),
      storeName: 'Spa',
      storeLogoUrl: null,
      settings: { featured: [], products: [] },
      context: {
        services: [svc(1, 'Corte'), svc(2, 'Tinte', { final_price: 71400, service_duration_unit: 'hour' })],
        featured_service_ids: [],
        products: [],
      },
    } as never);
    expect(preview.services.map((s) => [s.id, s.final_price, s.service_duration_unit])).toEqual([[2, 71400, 'hour']]);
  });
});
