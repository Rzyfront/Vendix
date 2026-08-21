import {
  PURCHASE_ORDER_SORT_DEFAULT,
  PURCHASE_ORDER_SORT_STORAGE_KEY,
  buildSortValue,
  isValidSortValue,
  loadSortPreference,
  parseSortValue,
  saveSortPreference,
} from './purchase-order-sort.util';

/**
 * El sort del listado de OC viaja como un único string compuesto
 * (`campo:dirección`) porque `FilterConfig` sólo transporta un valor por
 * filtro, pero el backend expone un enum cerrado en `sort_by`. Estas pruebas
 * blindan ese puente: nada fuera del catálogo puede llegar al query param.
 */
describe('purchase-order-sort.util', () => {
  beforeEach(() => localStorage.clear());
  afterAll(() => localStorage.clear());

  describe('loadSortPreference', () => {
    it('devuelve null cuando el storage está vacío', () => {
      expect(loadSortPreference()).toBeNull();
    });

    it('devuelve el valor guardado tras saveSortPreference', () => {
      saveSortPreference('total:desc');
      expect(loadSortPreference()).toBe('total:desc');
    });

    it('descarta un valor guardado que ya no pertenece al catálogo', () => {
      // Simula una opción renombrada en un release anterior: si se devolviera
      // tal cual, el backend respondería 400 por enum inválido.
      localStorage.setItem(PURCHASE_ORDER_SORT_STORAGE_KEY, 'created_at:desc');
      expect(loadSortPreference()).toBeNull();
    });

    it('devuelve null en silencio si el storage lanza al leer', () => {
      spyOn(localStorage, 'getItem').and.throwError('SecurityError');
      expect(() => loadSortPreference()).not.toThrow();
      expect(loadSortPreference()).toBeNull();
    });
  });

  describe('saveSortPreference', () => {
    it('absorbe los errores de cuota sin propagarlos', () => {
      spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
      expect(() => saveSortPreference('order_date:asc')).not.toThrow();
    });

    it('no persiste un valor fuera del catálogo', () => {
      saveSortPreference('DROP TABLE:desc');
      expect(
        localStorage.getItem(PURCHASE_ORDER_SORT_STORAGE_KEY),
      ).toBeNull();
    });
  });

  describe('parseSortValue', () => {
    it('parte order_date:desc en sus dos query params', () => {
      expect(parseSortValue('order_date:desc')).toEqual({
        sortBy: 'order_date',
        sortDir: 'desc',
      });
    });

    it('respeta la dirección ascendente', () => {
      expect(parseSortValue('next_payment_date:asc')).toEqual({
        sortBy: 'next_payment_date',
        sortDir: 'asc',
      });
    });

    it('cae al default ante null, vacío o un valor desconocido', () => {
      const fallback = parseSortValue(PURCHASE_ORDER_SORT_DEFAULT);
      expect(parseSortValue(null)).toEqual(fallback);
      expect(parseSortValue('')).toEqual(fallback);
      expect(parseSortValue('order_date')).toEqual(fallback);
      expect(parseSortValue('inyeccion_prisma:desc')).toEqual(fallback);
    });

    it('el default es "más recientes primero"', () => {
      expect(parseSortValue(PURCHASE_ORDER_SORT_DEFAULT)).toEqual({
        sortBy: 'order_date',
        sortDir: 'desc',
      });
    });
  });

  describe('buildSortValue', () => {
    it('compone campo y dirección', () => {
      expect(buildSortValue('supplier_name', 'asc')).toBe('supplier_name:asc');
    });

    it('es el inverso exacto de parseSortValue', () => {
      const { sortBy, sortDir } = parseSortValue('total:desc');
      expect(buildSortValue(sortBy, sortDir)).toBe('total:desc');
    });
  });

  describe('isValidSortValue', () => {
    it('acepta el default y rechaza cualquier cosa fuera del catálogo', () => {
      expect(isValidSortValue(PURCHASE_ORDER_SORT_DEFAULT)).toBe(true);
      expect(isValidSortValue('status:desc')).toBe(false);
      expect(isValidSortValue(null)).toBe(false);
      expect(isValidSortValue(42)).toBe(false);
    });
  });
});
