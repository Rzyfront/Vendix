import {
  classifyAcquirerAddressType,
  resolveAcquirerAddress,
} from './acquirer-address.resolver';

/**
 * La cascada existe para que un dato faltante NO se convierta ni en un municipio
 * inventado ni en una emisión bloqueada. Cada prueba de acá nombra cuál de las
 * dos evita.
 *
 * Los municipios usados son reales y salen del catálogo DIAN generado
 * (`constants/dian-geography.ts`): 05001 Medellín, 76001 Cali, 11001 Bogotá.
 */
describe('acquirer-address.resolver', () => {
  const MEDELLIN = {
    address_line: 'Cra 43A 1-50',
    city_code: '05001',
    city_name: 'Medellín',
    department_code: '05',
    department_name: 'Antioquia',
    country_code: 'CO',
  };
  const CALI = {
    address_line: 'Av 6N 25-30',
    city_code: '76001',
    city_name: 'Cali',
    department_code: '76',
    department_name: 'Valle Del Cauca',
    country_code: 'CO',
  };
  const STORE_BOGOTA = {
    address_line: 'Calle 100 8-60',
    city_code: '11001',
    city_name: 'Bogotá, D.c.',
    department_code: '11',
    department_name: 'Bogotá',
    country_code: 'CO',
  };

  describe('classifyAcquirerAddressType', () => {
    it('trata billing y legal como la dirección FISCAL', () => {
      expect(classifyAcquirerAddressType('billing')).toBe('fiscal');
      expect(classifyAcquirerAddressType('legal')).toBe('fiscal');
      expect(classifyAcquirerAddressType('BILLING')).toBe('fiscal');
    });

    it('trata cualquier otro tipo del enum como dirección de ENVÍO', () => {
      // `home` y `work` son domicilios reales del cliente y por eso sirven de
      // respaldo, pero no son lo que declaró como dirección de facturación: el
      // reporte no debe decir que lo son.
      for (const type of ['shipping', 'home', 'work', 'warehouse', 'delivery']) {
        expect(classifyAcquirerAddressType(type)).toBe('shipping');
      }
    });

    it('trata la dirección SIN tipo como fiscal', () => {
      // La compuso el llamador para ESTE documento (DTO sin fila detrás). Quien
      // la escribió la declaró como la dirección de la factura.
      expect(classifyAcquirerAddressType(null)).toBe('fiscal');
      expect(classifyAcquirerAddressType(undefined)).toBe('fiscal');
      expect(classifyAcquirerAddressType('  ')).toBe('fiscal');
    });
  });

  describe('resolveAcquirerAddress', () => {
    it('1. usa la dirección FISCAL del cliente cuando existe', () => {
      const resolved = resolveAcquirerAddress({
        candidates: [
          { ...CALI, type: 'shipping' },
          { ...MEDELLIN, type: 'billing' },
        ],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('fiscal');
      expect(resolved?.address.city_code).toBe('05001');
    });

    it('la fiscal gana aunque la de envío venga primero (orden de la base)', () => {
      // `invoice-flow` ordena por `is_primary desc`, no por tipo. Que la
      // principal del usuario sea la de envío no puede ganarle a una fiscal que
      // existe: «principal» y «fiscal» son dos conceptos distintos.
      const resolved = resolveAcquirerAddress({
        candidates: [
          { ...CALI, type: 'home' },
          { ...MEDELLIN, type: 'billing' },
        ],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('fiscal');
      expect(resolved?.address.city_name).toBe('Medellín');
    });

    it('2. cae a la dirección de ENVÍO cuando no hay fiscal', () => {
      const resolved = resolveAcquirerAddress({
        candidates: [{ ...CALI, type: 'shipping' }],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('shipping');
      expect(resolved?.address.city_code).toBe('76001');
      // El respaldo NO es Bogotá inventada: es el municipio real del envío.
      expect(resolved?.address.city_code).not.toBe('11001');
    });

    it('2-bis. una fiscal SIN municipio no bloquea: pasa el turno a la de envío', () => {
      // El caso que encallaba la emisión. La fila `billing` existe pero le falta
      // `municipality_code`, así que no es emitible; el cliente sí tiene una de
      // envío completa.
      const resolved = resolveAcquirerAddress({
        candidates: [
          {
            type: 'billing',
            address_line: 'Sin municipio 123',
            country_code: 'CO',
          },
          { ...CALI, type: 'shipping' },
        ],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('shipping');
      expect(resolved?.address.city_code).toBe('76001');
    });

    it('3. cae a la dirección de la TIENDA cuando el cliente no tiene ninguna', () => {
      const resolved = resolveAcquirerAddress({
        candidates: [],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('store');
      expect(resolved?.address.city_code).toBe('11001');
    });

    it('3-bis. cae a la TIENDA cuando ninguna dirección del cliente es emitible', () => {
      const resolved = resolveAcquirerAddress({
        candidates: [
          {
            type: 'shipping',
            address_line: 'Calle sin municipio',
            city_name: 'Municipio Que No Existe',
            country_code: 'CO',
          },
        ],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('store');
    });

    it('4. devuelve null —no una dirección fabricada— cuando se acaban los escalones', () => {
      // `null` significa «no lo sé». El llamador lo convierte en un error
      // accionable; lo que NO puede pasar es que salga un municipio que nadie
      // eligió, porque ese documento la DIAN lo ACEPTA con el consecutivo ya
      // gastado y sólo se corrige con nota crédito.
      expect(
        resolveAcquirerAddress({ candidates: [], store_address: null }),
      ).toBeNull();

      expect(
        resolveAcquirerAddress({
          candidates: [{ type: 'billing', country_code: 'CO' }],
          store_address: {
            address_line: 'Tienda sin municipio',
            country_code: 'CO',
          },
        }),
      ).toBeNull();
    });

    it('acepta un adquiriente EXTRANJERO sin municipio Divipola', () => {
      // FAK09-FAK12 declaran los cuatro elementos Divipola `0..1` para el
      // adquiriente. Exigir municipio DANE a un cliente de fuera bloquearía toda
      // factura de exportación.
      const resolved = resolveAcquirerAddress({
        candidates: [
          {
            type: 'billing',
            address_line: '5th Avenue 101',
            city_name: 'New York',
            country_code: 'US',
          },
        ],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('fiscal');
      expect(resolved?.address.country_code).toBe('US');
    });

    it('descarta una fila vacía en vez de dejar que gane el turno', () => {
      // Una fila con sólo país extranjero no lanza en el rol de adquiriente,
      // así que sin este filtro «ganaría» y la cascada se detendría en una
      // dirección que no dice nada.
      const resolved = resolveAcquirerAddress({
        candidates: [{ type: 'billing', country_code: 'US' }],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.source).toBe('store');
    });

    it('no deja escapar el metadato `type` hacia el XML', () => {
      const resolved = resolveAcquirerAddress({
        candidates: [{ ...MEDELLIN, type: 'billing' }],
        store_address: STORE_BOGOTA,
      });

      expect(resolved?.address).not.toHaveProperty('type');
    });

    it('rechaza una dirección de tienda que el EMISOR no podría declarar', () => {
      // El emisor debe estar en Colombia (FAJ16) y con municipio Divipola
      // (FAJ09). Una tienda cuya dirección no aguanta su propio rol no puede
      // ser el respaldo de nadie.
      const resolved = resolveAcquirerAddress({
        candidates: [],
        store_address: {
          address_line: '742 Evergreen Terrace',
          city_name: 'Springfield',
          country_code: 'US',
        },
      });

      expect(resolved).toBeNull();
    });
  });
});
