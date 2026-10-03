import { AiScanHandlerRegistry } from './ai-scan-handler.registry';

describe('AiScanHandlerRegistry', () => {
  it('registra y devuelve el handler', () => {
    const r = new AiScanHandlerRegistry();
    const h = jest.fn();
    r.register('rut', h);
    expect(r.get('rut')).toBe(h);
  });

  it('devuelve undefined si no existe', () => {
    expect(new AiScanHandlerRegistry().get('rut')).toBeUndefined();
  });

  it('lanza en doble registro del mismo kind', () => {
    const r = new AiScanHandlerRegistry();
    r.register('rut', jest.fn());
    expect(() => r.register('rut', jest.fn())).toThrow(/already registered/);
  });
});
