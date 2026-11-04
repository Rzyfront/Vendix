import { providerDisplayName } from './provider-name.util';

describe('providerDisplayName', () => {
  it('display_name → usuario → empleado → vacío', () => {
    expect(providerDisplayName({ display_name: ' Ana ', user: { first_name: 'X' } })).toBe('Ana');
    expect(providerDisplayName({ display_name: null, user: { first_name: 'Ana', last_name: 'Ruiz' } })).toBe('Ana Ruiz');
    expect(providerDisplayName({ user: null, employee: { first_name: 'Luis', last_name: null } })).toBe('Luis');
    expect(providerDisplayName({})).toBe('');
    expect(providerDisplayName(null)).toBe('');
  });
});
