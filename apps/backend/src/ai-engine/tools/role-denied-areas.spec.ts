import { roleDeniedAreas, roleDeniedAreasPrompt } from './role-denied-areas';

describe('role denied areas (T13 / N4)', () => {
  it('groups store permissions by area with sorted, deduplicated actions', () => {
    expect(
      roleDeniedAreas([
        'store:payroll:read',
        'store:orders:cancel',
        'store:orders:refund',
        'store:orders:cancel',
        'store:inventory:stock_levels:adjust',
      ]),
    ).toEqual([
      { area: 'inventory', actions: ['stock_levels.adjust'] },
      { area: 'orders', actions: ['cancel', 'refund'] },
      { area: 'payroll', actions: ['read'] },
    ]);
  });

  it('builds the Spanish fragment from areas, never from tool names', () => {
    const text = roleDeniedAreasPrompt([
      'store:orders:cancel',
      'store:payroll:read',
    ])!;
    expect(text).toContain(
      'Áreas que el rol de este usuario no permite: orders (cancel), payroll (read).',
    );
    expect(text).toContain('tu rol no permite <acción>; pídeselo al dueño');
    expect(text).toContain('sin proponer tarjeta ni llamar herramientas');
    expect(text).not.toMatch(/cancel_order|list_orders|store:/);
  });

  it('returns no fragment when the role lacks nothing', () => {
    expect(roleDeniedAreas([])).toEqual([]);
    expect(roleDeniedAreasPrompt([])).toBeNull();
  });

  it('keeps unscoped permissions as an area and caps a very long list', () => {
    expect(roleDeniedAreas(['admin'])).toEqual([{ area: 'admin', actions: [] }]);
    const many = Array.from({ length: 20 }, (_, i) => `store:a${String(i).padStart(2, '0')}:read`);
    expect(roleDeniedAreasPrompt(many)).toContain('y 5 más');
  });
});
