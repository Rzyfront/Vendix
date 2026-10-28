import {
  customerDisplayName,
  resolveCustomerSnapshotName,
} from './customer-display-name.helper';

describe('customerDisplayName', () => {
  it('prefers legal_name (razón social) for JURIDICA customers', () => {
    expect(
      customerDisplayName({
        legal_name: ' ÓPTICA PANORAMA SAS ',
        first_name: null,
        last_name: null,
      }),
    ).toBe('ÓPTICA PANORAMA SAS');
  });

  it('joins first_name + last_name for NATURAL customers', () => {
    expect(
      customerDisplayName({ first_name: 'Juan', last_name: 'Pérez' }),
    ).toBe('Juan Pérez');
  });

  it('returns the fallback when there is no usable name', () => {
    expect(customerDisplayName(null, 'Cliente')).toBe('Cliente');
    expect(customerDisplayName({ legal_name: '  ' }, 'Cliente')).toBe(
      'Cliente',
    );
  });
});

describe('resolveCustomerSnapshotName', () => {
  it('keeps a non-empty snapshot', () => {
    expect(
      resolveCustomerSnapshotName('Juan Pérez', { legal_name: 'OTRA SAS' }),
    ).toBe('Juan Pérez');
  });

  it('falls back to the live customer when the snapshot is blank', () => {
    expect(
      resolveCustomerSnapshotName('', { legal_name: 'ÓPTICA PANORAMA SAS' }),
    ).toBe('ÓPTICA PANORAMA SAS');
    expect(resolveCustomerSnapshotName(null, null)).toBe('');
  });
});
