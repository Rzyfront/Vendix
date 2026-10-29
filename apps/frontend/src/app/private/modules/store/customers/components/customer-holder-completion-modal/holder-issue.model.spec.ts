import {
  effectiveMissingFields,
  holderCurrentFrom,
  holderIssueFromDetails,
  presentHolderData,
} from './holder-issue.model';

/**
 * «Datos del cliente incompletos»: what the modal shows as already on file,
 * what it asks for, and how it reads the 409 `details`. Pure functions.
 */
describe('holder-issue.model', () => {
  const details = {
    order_id: 1305,
    customer_id: 260,
    customer_name: 'Qa Ecommerce',
    issue_code: 'missing_document_number',
    missing_fields: ['document_number'],
    message: 'Al cliente Qa Ecommerce le falta el número de documento.',
    cf_overridable: true,
    current: {
      document_type: null,
      document_number: null,
      verification_digit: null,
      legal_name: null,
      first_name: 'Qa',
      last_name: 'Ecommerce',
    },
  };

  it('reads the data on file from the 409 details', () => {
    const issue = holderIssueFromDetails(details);
    expect(issue?.current).toEqual(details.current);
    expect(issue?.cf_blocker).toBeNull();
  });

  it('reads the Consumidor final blocker after an explicit opt-in', () => {
    const issue = holderIssueFromDetails({
      ...details,
      cf_overridable: false,
      cf_blocker: 'unpaid_balance',
    });
    expect(issue?.cf_blocker).toBe('unpaid_balance');
    expect(issue?.cf_overridable).toBeFalse();
  });

  it('payload without current (POS holder-check) keeps current absent', () => {
    const { current: _omit, ...rest } = details;
    expect(holderIssueFromDetails(rest)?.current).toBeNull();
  });

  it('asks the document type too when the number is missing and no type is on file', () => {
    expect(effectiveMissingFields(['document_number'], details.current)).toEqual([
      'document_type',
      'document_number',
    ]);
  });

  it('does not ask the document type when it is already on file', () => {
    expect(
      effectiveMissingFields(['document_number'], {
        ...details.current,
        document_type: 'CC',
      }),
    ).toEqual(['document_number']);
  });

  it('lists only what is on file and not missing, with its value', () => {
    expect(presentHolderData(details.current, ['document_type', 'document_number'])).toEqual([
      { label: 'Nombres', value: 'Qa' },
      { label: 'Apellidos', value: 'Ecommerce' },
    ]);
  });

  it('shows a NIT with its DV', () => {
    expect(
      presentHolderData(
        {
          document_type: 'NIT',
          document_number: '900123456',
          verification_digit: '8',
          legal_name: null,
          first_name: null,
          last_name: null,
        },
        ['legal_name', 'first_name', 'last_name'],
      ),
    ).toEqual([
      { label: 'Tipo de documento', value: 'NIT' },
      { label: 'Número de documento', value: '900123456-8' },
    ]);
  });

  it('treats the Consumidor final sentinel as an absent document', () => {
    expect(
      holderCurrentFrom({ document_type: 'CC', document_number: '222222222222', first_name: 'Ana' }),
    ).toEqual({
      document_type: 'CC',
      document_number: null,
      verification_digit: null,
      legal_name: null,
      first_name: 'Ana',
      last_name: null,
    });
  });

  it('reads a buyer without customer (guest billing data, prod order 15298) instead of dropping it', () => {
    const issue = holderIssueFromDetails({
      order_id: 15298,
      customer_id: null,
      customer_name: 'Andrea león',
      issue_code: 'missing_document_number',
      missing_fields: ['document_number', 'last_name'],
      current: {
        document_type: null,
        document_number: null,
        verification_digit: null,
        legal_name: null,
        first_name: 'Andrea león',
        last_name: null,
      },
      message: 'Al comprador (datos de facturación del pedido) Andrea león le falta…',
      cf_overridable: true,
    });
    expect(issue).not.toBeNull();
    expect(issue?.customer_id).toBeNull();
    expect(issue?.customer_name).toBe('Andrea león');
    expect(issue?.cf_overridable).toBeTrue();
  });

  it('is null for a payload that is not a holder issue', () => {
    expect(holderIssueFromDetails({ order_id: 1, customer_id: null })).toBeNull();
  });
});

