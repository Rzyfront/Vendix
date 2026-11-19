import {
  activePlants,
  autoOrderPlantId,
  isOrderPlantRequired,
  mainPlantId,
  orderPlantIdToSend,
  orderPlantOptions,
  plantSessionStorageKey,
  PlantRef,
  resolveSessionPlantId,
} from './plant-selection.util';

/** QUI-1013 — choosing the plant of an order and of the production session. */
describe('plant-selection.util (QUI-1013)', () => {
  const plant = (id: number, over: Partial<PlantRef> = {}): PlantRef => ({
    id,
    name: `Planta ${id}`,
    is_active: true,
    ...over,
  });

  describe('session plant', () => {
    it('with one plant (or none) the session shows the whole store, as before', () => {
      expect(resolveSessionPlantId([], '3', '3')).toBeNull();
      expect(resolveSessionPlantId([plant(1)], '1', null)).toBeNull();
      expect(resolveSessionPlantId([plant(1), plant(2, { is_active: false })], '2', null)).toBeNull();
    });

    it('with several plants the URL wins, then this device, then the main plant', () => {
      const plants = [plant(1, { is_main: true }), plant(2), plant(3)];
      expect(resolveSessionPlantId(plants, '3', '2')).toBe(3);
      expect(resolveSessionPlantId(plants, null, '2')).toBe(2);
      expect(resolveSessionPlantId(plants, null, null)).toBe(1);
    });

    it('ignores an id that is not an active plant of the store', () => {
      const plants = [plant(1), plant(2), plant(3, { is_active: false })];
      expect(resolveSessionPlantId(plants, '3', null)).toBe(1);
      expect(resolveSessionPlantId(plants, '99', 'abc')).toBe(1);
      expect(resolveSessionPlantId(plants, '', '2')).toBe(2);
    });

    it('remembers the plant per store', () => {
      expect(plantSessionStorageKey(7)).toBe('vendix_manufacturing_plant_session:7');
      expect(plantSessionStorageKey(null)).toBeNull();
    });
  });

  describe('main plant', () => {
    it('is the plant flagged by the API, else the first active by id', () => {
      expect(mainPlantId([plant(5), plant(2, { is_main: true })])).toBe(2);
      expect(mainPlantId([plant(5), plant(2, { is_active: false }), plant(3)])).toBe(3);
      expect(mainPlantId([])).toBeNull();
    });

    it('active plants come sorted by id', () => {
      expect(activePlants([plant(3), plant(1, { is_active: false }), plant(2)]).map((p) => p.id)).toEqual([2, 3]);
    });
  });

  describe('order plant', () => {
    it('one active plant: assigned without asking', () => {
      expect(autoOrderPlantId([plant(1)])).toBe(1);
      expect(isOrderPlantRequired([plant(1), plant(2, { is_active: false })])).toBeFalse();
    });

    it('several active plants: the form must ask', () => {
      expect(autoOrderPlantId([plant(1), plant(2)])).toBeNull();
      expect(isOrderPlantRequired([plant(1), plant(2)])).toBeTrue();
    });

    it('no plant: nothing to ask, the store works as before', () => {
      expect(autoOrderPlantId([])).toBeNull();
      expect(isOrderPlantRequired([])).toBeFalse();
    });

    it('the selector lists active plants plus the order plant deactivated later', () => {
      const plants = [plant(1), plant(2, { name: 'Zapatos', is_active: false }), plant(3)];
      expect(orderPlantOptions(plants, null)).toEqual([
        { value: 1, label: 'Planta 1' },
        { value: 3, label: 'Planta 3' },
      ]);
      expect(orderPlantOptions(plants, 2)).toEqual([
        { value: 1, label: 'Planta 1' },
        { value: 3, label: 'Planta 3' },
        { value: 2, label: 'Zapatos (inactiva)' },
      ]);
    });

    it('create sends the chosen plant; none lets the API assign the only one', () => {
      expect(orderPlantIdToSend(2, null, false)).toBe(2);
      expect(orderPlantIdToSend(null, null, false)).toBeUndefined();
    });

    it('edit sends the plant only when it changed', () => {
      expect(orderPlantIdToSend(2, 2, true)).toBeUndefined();
      expect(orderPlantIdToSend(3, 2, true)).toBe(3);
      expect(orderPlantIdToSend(null, 2, true)).toBeUndefined();
    });
  });
});
