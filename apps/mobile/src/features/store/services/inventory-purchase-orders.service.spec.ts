/**
 * CP-PURCHASE-TRANSPARENCY A.10 — la cadena de compra de la pantalla
 * `inventory/purchase.tsx`.
 *
 * Lo que se fija aquí es la parte que fallaba EN SILENCIO: la pantalla mandaba
 * `status: 'approved'` en el cuerpo de creación, el backend lo descarta
 * (`status: _clientStatusIgnored`) y escribe `draft` de oficio, así que
 * devolvía 201 con un borrador que la app anunciaba como orden aprobada. Nadie
 * veía un error; la orden simplemente se quedaba sin `approved_by_user_id` y
 * la recepción posterior era imposible, porque `receive()` afirma la
 * transición a `partial` y un `draft` sólo transita a `approved` o
 * `cancelled`.
 *
 * Por eso los tests miran el CUERPO y la RUTA, no el valor de retorno: el bug
 * vivía justamente en lo que se enviaba.
 */
import { apiClient } from '@/core/api';
import { InventoryService } from './inventory.service';
import type { CreatePurchaseOrderDto } from '../types';

jest.mock('@/core/api', () => ({
  ...jest.requireActual('@/core/api'),
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockClient = apiClient as unknown as {
  post: jest.Mock;
  patch: jest.Mock;
};

const basePayload: CreatePurchaseOrderDto = {
  supplier_id: 7,
  location_id: 3,
  order_date: '2026-08-22T00:00:00.000Z',
  subtotal_amount: 1000,
  tax_amount: 0,
  total_amount: 1000,
  notes: 'Creada desde Vendix Mobile',
  items: [{ product_id: 11, quantity: 2, unit_price: 500 }],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createPurchaseOrder — el cuerpo NO lleva status', () => {
  it('publica en /store/orders/purchase-orders sin la clave `status`', async () => {
    mockClient.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 91, status: 'draft' } },
    });

    await InventoryService.createPurchaseOrder(basePayload);

    expect(mockClient.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockClient.post.mock.calls[0];
    expect(url).toBe('/store/orders/purchase-orders');
    expect(body).not.toHaveProperty('status');
  });

  it('devuelve la orden tal como nace: en borrador', async () => {
    mockClient.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 92, status: 'draft' } },
    });

    /*
     * El servicio reenvía el DTO tal cual, así que la garantía de que `status`
     * no vuelva es de TIPOS: `CreatePurchaseOrderDto` ya no lo declara y
     * `basePayload` no compilaría con él. Lo que este test fija es la
     * consecuencia que la pantalla debe asumir — lo creado es un BORRADOR — y
     * que por lo tanto la aprobación tiene que ser una llamada aparte.
     */
    const created = await InventoryService.createPurchaseOrder(basePayload);

    expect(created.status).toBe('draft');
  });
});

describe('approvePurchaseOrder — la etapa que cierra la cadena', () => {
  it('llama PATCH /store/orders/purchase-orders/:id/approve con el id real', async () => {
    mockClient.patch.mockResolvedValueOnce({
      data: { success: true, data: { id: 91, status: 'approved' } },
    });

    const result = await InventoryService.approvePurchaseOrder(91);

    expect(mockClient.patch).toHaveBeenCalledTimes(1);
    expect(mockClient.patch.mock.calls[0][0]).toBe(
      '/store/orders/purchase-orders/91/approve',
    );
    expect(result.status).toBe('approved');
  });

  it('propaga el fallo de aprobación en vez de tragárselo', async () => {
    mockClient.patch.mockRejectedValueOnce(new Error('Forbidden'));

    await expect(InventoryService.approvePurchaseOrder(91)).rejects.toThrow('Forbidden');
  });
});

describe('receivePurchaseOrder — el id es el de la LÍNEA, no un índice', () => {
  it('manda los ids de línea que devolvió la orden creada', async () => {
    mockClient.patch.mockResolvedValueOnce({
      data: { success: true, data: { id: 91, status: 'received' } },
    });

    /*
     * Los ids reales sólo existen DESPUÉS de crear la orden. El backend
     * rechaza con 400 («La línea N no pertenece a esta orden de compra»)
     * cualquier id que no sea suyo — mandar `0` nunca pudo funcionar.
     */
    const createdLines = [
      { id: 501, quantity_ordered: 2 },
      { id: 502, quantity_ordered: 5 },
    ];
    const receiveItems = createdLines.map((line) => ({
      id: line.id,
      quantity_received: line.quantity_ordered,
    }));

    await InventoryService.receivePurchaseOrder(91, receiveItems, 'Stock recibido desde Vendix Mobile');

    const [url, body] = mockClient.patch.mock.calls[0];
    expect(url).toBe('/store/orders/purchase-orders/91/receive');
    expect(body.items).toEqual([
      { id: 501, quantity_received: 2 },
      { id: 502, quantity_received: 5 },
    ]);
    expect(body.items.every((i: { id: number }) => i.id > 0)).toBe(true);
  });
});
