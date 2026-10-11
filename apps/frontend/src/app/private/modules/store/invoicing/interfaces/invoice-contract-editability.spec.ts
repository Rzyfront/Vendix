import { canEditContractInvoice } from './invoice-contract-editability';

describe('canEditContractInvoice', () => {
  it('keeps ordinary invoices editable, including missing or null relation fields', () => {
    expect(canEditContractInvoice(null)).toBeTrue();
    expect(canEditContractInvoice(undefined)).toBeTrue();
    expect(canEditContractInvoice({})).toBeTrue();
    expect(canEditContractInvoice({ contract_id: null })).toBeTrue();
    expect(canEditContractInvoice({ contract_id: 0 })).toBeTrue();
  });

  it('makes a contract-linked invoice immutable when contract_id is positive', () => {
    expect(canEditContractInvoice({ contract_id: 1 })).toBeFalse();
    expect(canEditContractInvoice({ contract_id: 72 })).toBeFalse();
  });
});
