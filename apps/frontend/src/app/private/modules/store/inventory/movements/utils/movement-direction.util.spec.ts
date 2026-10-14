import { isInboundMovement } from './movement-direction.util';

describe('isInboundMovement', () => {
  it('treats every outbound-only movement type as outbound when direction is ambiguous', () => {
    for (const movement_type of [
      'stock_out',
      'sale',
      'damage',
      'expiration',
      'consumption',
    ]) {
      expect(isInboundMovement({ movement_type }))
        .withContext(movement_type)
        .toBeFalse();
      expect(
        isInboundMovement({
          from_location_id: null,
          to_location_id: 5,
          movement_type,
        }),
      )
        .withContext(movement_type)
        .toBeFalse();
    }
  });

  it('treats stock_in, return, adjustment and unknown types as inbound by fallback', () => {
    for (const movement_type of ['stock_in', 'return', 'adjustment', 'unknown']) {
      expect(isInboundMovement({ movement_type }))
        .withContext(movement_type)
        .toBeTrue();
    }
  });

  it('uses an origin-only leg as outbound, including zero as a present ID', () => {
    expect(isInboundMovement({ from_location_id: 5 })).toBeFalse();
    expect(
      isInboundMovement({ from_location_id: 5, to_location_id: null }),
    ).toBeFalse();
    expect(isInboundMovement({ from_location_id: 0 })).toBeFalse();
    expect(
      isInboundMovement({ from_location_id: 0, movement_type: 'stock_in' }),
    ).toBeFalse();
  });

  it('uses a destination-only leg as inbound unless a legacy outbound type says otherwise', () => {
    expect(
      isInboundMovement({ to_location_id: 5, movement_type: 'adjustment' }),
    ).toBeTrue();
    expect(
      isInboundMovement({ to_location_id: 0, movement_type: 'return' }),
    ).toBeTrue();
    expect(
      isInboundMovement({ to_location_id: null, movement_type: 'adjustment' }),
    ).toBeTrue();
  });

  it('treats both location legs as inbound, including zero, before movement type', () => {
    expect(
      isInboundMovement({
        from_location_id: 5,
        to_location_id: 7,
        movement_type: 'transfer',
      }),
    ).toBeTrue();
    expect(
      isInboundMovement({
        from_location_id: 0,
        to_location_id: 7,
        movement_type: 'stock_out',
      }),
    ).toBeTrue();
    expect(
      isInboundMovement({
        from_location_id: 5,
        to_location_id: 0,
        movement_type: 'sale',
      }),
    ).toBeTrue();
  });

  it('preserves the historical fallback for absent movement and null location legs', () => {
    expect(isInboundMovement(undefined)).toBeTrue();
    expect(isInboundMovement(null)).toBeTrue();
    expect(
      isInboundMovement({ from_location_id: null, to_location_id: null }),
    ).toBeTrue();
    expect(
      isInboundMovement({
        from_location_id: null,
        to_location_id: null,
        movement_type: 'damage',
      }),
    ).toBeFalse();
  });
});
