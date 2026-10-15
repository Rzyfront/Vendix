import { createCustomerBillingForm } from './customer-billing-fields.component';
import { computeNitDv } from '../../utils/nit.util';
describe('customer billing capture', () => {
  function natural() {
    const f = createCustomerBillingForm();
    f.patchValue({
      first_name: 'María',
      last_name: 'Pérez',
      document_type: 'PA',
      document_number: 'AB123456',
      email: 'cliente@example.test',
    });
    return f;
  }
  it('requires email and rejects invalid email', () => {
    const f = natural();
    expect(f.valid).toBeTrue();
    f.controls.email.setValue('');
    expect(f.invalid).toBeTrue();
    f.controls.email.setValue('invalid');
    expect(f.invalid).toBeTrue();
  });
  it('requires names for natural but accepts passport PA', () => {
    const f = natural();
    f.controls.first_name.setValue('');
    expect(f.invalid).toBeTrue();
  });
  it('accepts juridica legal name and NIT/DV without personal names', () => {
    const f = createCustomerBillingForm();
    f.patchValue({
      person_type: 'JURIDICA',
      document_type: 'NIT',
      document_number: '900123456',
      verification_digit: computeNitDv('900123456')!,
      legal_name: 'Empresa SAS',
      email: 'facturas@example.test',
    });
    expect(f.valid).toBeTrue();
    f.controls.verification_digit.setValue('9');
    expect(f.invalid).toBeTrue();
  });
  it('rejects consumer-final sentinel', () => {
    const f = natural();
    f.patchValue({
      document_type: 'NIT',
      document_number: '222222222222',
      verification_digit: '7',
    });
    expect(f.invalid).toBeTrue();
  });
});
