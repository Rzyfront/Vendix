import { isOptOutKeyword } from './opt-out-keywords.util';

describe('isOptOutKeyword', () => {
  it.each(['STOP', 'stop', 'Baja', ' baja. ', 'NO MÁS', 'no mas!', 'Dar de baja', 'Cancelar suscripción', 'unsubscribe'])(
    'opts out on %p',
    (text) => expect(isOptOutKeyword(text)).toBe(true),
  );

  it.each(['no más rápido, por favor', 'quiero dar de baja mi pedido', 'stopper', '', null, undefined, 'hola'])(
    'ignores %p',
    (text) => expect(isOptOutKeyword(text)).toBe(false),
  );
});
