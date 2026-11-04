import { OrderTicketService } from './order-ticket.service';
import { Order, OrderItem } from '../interfaces/order.interface';

describe('OrderTicketService — línea de PESO no se imprime como empaque', () => {
  const service = new OrderTicketService();
  const line = (overrides: Partial<OrderItem>): OrderItem =>
    ({
      id: 1,
      product_name: 'Queso costeño',
      quantity: 1,
      unit_price: 20000,
      total_price: 3600,
      ...overrides,
    }) as OrderItem;

  it('pesada de 0,180 kg con 180 g descontados: sin "×180" ni presentación', () => {
    const item = line({ weight: '0.180', weight_unit: 'kg', stock_units_consumed: 180 });
    expect(service.hasPackageStockConsumption(item)).toBe(false);
    expect(service.packageMultiplier(item)).toBeNull();

    const ticket = service.toTicketData({ order_items: [item] } as unknown as Order);
    expect(ticket.items[0].isPackageUnit).toBe(false);
    expect(ticket.items[0].unitsPerPackage).toBeNull();
  });

  it('presentación real (1 bulto de 50) sigue mostrando ×50', () => {
    const item = line({ stock_units_consumed: 50 });
    expect(service.hasPackageStockConsumption(item)).toBe(true);
    expect(service.packageMultiplier(item)).toBe(50);
  });
});
