import {
  formatSaleQuantity,
  isPresentationLine,
  isSaleUnitLine,
  resolveLinePackSize,
  resolveLineUnits,
  resolvePriceUnitQuantity,
  resolveSaleQuantity,
} from './line-units.util';

/**
 * Estos casos existen por un defecto de producción — QUI-648.
 *
 * `price_tiers` cumple DOS papeles y el carrito los confundía preguntando por
 * `applied_price_tier_id`:
 *
 *  - una PRESENTACIÓN ("Rollo 20 m") cambia la MAGNITUD de `quantity` —cuenta
 *    paquetes— y su precio ya es el del paquete entero: la escala del producto
 *    no aplica;
 *  - una TARIFA DE CLIENTE ("Mayorista") cambia solo el NÚMERO del precio, que
 *    sigue publicado por unidad de precio: la escala aplica igual que sin
 *    tarifa.
 *
 * Excluir las dos hacía que un cable de 1 mm de unidad mínima, escala 1000 y
 * tarifa Mayorista a $4.500 el metro cobrara 2 m como **$9.000.000**, y el
 * backend rechazaba la venta con "El producto no permite editar el precio en
 * POS". O sea: ningún producto con escala se podía vender con tarifa de cliente.
 *
 * Lo que se fija acá es la frontera: la exclusión es el EMPAQUE (`packSize > 1`),
 * no la existencia de una tarifa.
 */
describe('line-units.util', () => {
  /** El cable del defecto: se guarda en milímetros y se publica por metro. */
  const CABLE_SCALE = 1000;

  describe('resolveLineUnits', () => {
    it('divide por la escala con TARIFA DE CLIENTE aplicada: "Mayorista" cambia el precio, no la unidad en que está expresado', () => {
      // 2 m de cable = 2.000 mm. La tarifa Mayorista no vuelve el precio
      // "por milímetro": sigue siendo por metro, así que la línea cobra 2
      // unidades de precio.
      const units = resolveLineUnits({
        quantity: 2000,
        applied_price_tier_id: 7,
        is_package_unit: false,
        units_per_package: null,
        price_unit_quantity: CABLE_SCALE,
      });

      expect(units).toBe(2);
    });

    it('cobra $9.000 y no $9.000.000 por 2 m a $4.500 el metro con tarifa Mayorista', () => {
      // El número exacto del defecto reportado: el POS mandaba el total inflado
      // y el guard de `allow_pos_price_override` rechazaba la venta entera.
      const units = resolveLineUnits({
        quantity: 2000,
        applied_price_tier_id: 7,
        is_package_unit: false,
        units_per_package: null,
        price_unit_quantity: CABLE_SCALE,
      });

      expect(4500 * units).toBe(9000);
    });

    it('NO divide con PRESENTACIÓN aplicada: "Rollo 20 m" ya publica el precio del paquete y `quantity` cuenta rollos', () => {
      // Volver a dividir acá cobraría de menos: 3 rollos se convertirían en
      // 0,003 unidades de precio.
      const units = resolveLineUnits({
        quantity: 3,
        applied_price_tier_id: 9,
        is_package_unit: true,
        units_per_package: 20,
        price_unit_quantity: CABLE_SCALE,
      });

      expect(units).toBe(3);
    });

    it('sigue usando el peso capturado en la línea de PESO legado, aunque el producto declare escala', () => {
      // Ahí `quantity` vale 1 y el multiplicador real es el peso. Dividir el 1
      // por la escala colapsaría el total: 1,35 kg de queso a $22.000 el kilo
      // se cobrarían como $22.
      const units = resolveLineUnits({
        quantity: 1,
        weight: 1.35,
        weight_unit: 'kg',
        is_weight_product: true,
        price_unit_quantity: CABLE_SCALE,
      });

      expect(units).toBe(1.35);
      expect(22000 * units).toBeCloseTo(29700, 2);
    });

    it('con escala 1 devuelve la cantidad tal cual: la aritmética histórica de todo el catálogo por pieza', () => {
      // Ninguna línea existente puede cambiar de total por esta feature.
      expect(resolveLineUnits({ quantity: 4, price_unit_quantity: 1 })).toBe(4);
      expect(resolveLineUnits({ quantity: 4, price_unit_quantity: null })).toBe(4);
      expect(resolveLineUnits({ quantity: 4 })).toBe(4);
    });

    it('no toma por presentación una bandera `is_package_unit` sin empaque real: sin paquete que contar, manda la escala', () => {
      // La bandera y el número los escribe el mismo resolver, pero el número es
      // la autoridad: `units_per_package` 1 o nulo significa "una unidad por
      // paquete", que no es una presentación.
      expect(
        resolveLineUnits({
          quantity: 2000,
          applied_price_tier_id: 7,
          is_package_unit: true,
          units_per_package: 1,
          price_unit_quantity: CABLE_SCALE,
        }),
      ).toBe(2);

      expect(
        resolveLineUnits({
          quantity: 2000,
          applied_price_tier_id: 7,
          is_package_unit: true,
          units_per_package: null,
          price_unit_quantity: CABLE_SCALE,
        }),
      ).toBe(2);
    });

    it('divide igual sin tarifa: la escala es del PRODUCTO, la tarifa solo elige el número', () => {
      expect(
        resolveLineUnits({ quantity: 2000, price_unit_quantity: CABLE_SCALE }),
      ).toBe(2);
    });
  });

  describe('isPresentationLine', () => {
    it('reconoce la presentación por el empaque, que es el criterio del backend (`isPresentationAtIndex`)', () => {
      expect(isPresentationLine({ quantity: 3, units_per_package: 20 })).toBe(true);
    });

    it('no reconoce una tarifa de cliente como presentación aunque traiga id de tarifa', () => {
      expect(
        isPresentationLine({
          quantity: 2000,
          applied_price_tier_id: 7,
          is_package_unit: false,
          units_per_package: null,
        }),
      ).toBe(false);
    });
  });

  describe('resolveLinePackSize', () => {
    it('sanea el empaque a entero > 1, o 1 cuando no hay paquete', () => {
      expect(resolveLinePackSize({ quantity: 1, units_per_package: 20 })).toBe(20);
      expect(resolveLinePackSize({ quantity: 1, units_per_package: 1 })).toBe(1);
      expect(resolveLinePackSize({ quantity: 1, units_per_package: 0 })).toBe(1);
      expect(resolveLinePackSize({ quantity: 1, units_per_package: null })).toBe(1);
      expect(resolveLinePackSize({ quantity: 1 })).toBe(1);
    });
  });

  describe('resolvePriceUnitQuantity', () => {
    it('sanea la escala a entero > 1, o 1: nunca divide por cero ni por un negativo', () => {
      expect(resolvePriceUnitQuantity(1000)).toBe(1000);
      expect(resolvePriceUnitQuantity('1000.7')).toBe(1000);
      expect(resolvePriceUnitQuantity(1)).toBe(1);
      expect(resolvePriceUnitQuantity(0)).toBe(1);
      expect(resolvePriceUnitQuantity(-5)).toBe(1);
      expect(resolvePriceUnitQuantity(null)).toBe(1);
      expect(resolvePriceUnitQuantity('no es un número')).toBe(1);
    });
  });

  describe('unidad que ve el cajero', () => {
    it('mantiene "3 m" con tarifa de cliente aplicada: el cajero nunca lee milímetros', () => {
      // Tercer síntoma del mismo defecto: al aplicar Mayorista la línea perdía
      // `sale_unit_code` y `stock_units_per_sale_unit`, y el carrito pasaba a
      // mostrar 3.000 en vez de "3 m".
      const linea = {
        quantity: 3000,
        applied_price_tier_id: 7,
        is_package_unit: false,
        units_per_package: null,
        price_unit_quantity: CABLE_SCALE,
        sale_unit_code: 'm',
        stock_units_per_sale_unit: CABLE_SCALE,
      };

      expect(resolveSaleQuantity(linea)).toBe(3);
      expect(isSaleUnitLine(linea)).toBe(true);
      expect(formatSaleQuantity(linea)).toBe('3 m');
    });

    it('muestra el peso con su unidad en la línea de peso, no la cantidad', () => {
      // El separador decimal lo pone el locale del navegador que corre la
      // suite, así que se afirma la forma y no el carácter.
      expect(
        formatSaleQuantity({
          quantity: 1,
          weight: 2.35,
          weight_unit: 'kg',
          is_weight_product: true,
        }),
      ).toMatch(/^2[.,]35 kg$/);
    });
  });
});
