import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateDianConfigDto } from './update-dian-config.dto';

/**
 * `certificate_kms_key_id` is the switch that moves the certificate's private key
 * into an HSM. It is pasted by hand from the AWS console, and a wrong value does
 * not degrade: KMS rejects the signature, so EVERY document and every SOAP
 * envelope fails until someone notices. Validating the shape at the edge is what
 * turns that outage into a 400 on the settings screen.
 *
 * The same class of defect already reached production once through this DTO —
 * `test_set_id` accepted values like `"9547"` where a UUID was required, which is
 * why these fields are shape-checked rather than merely typed as strings.
 */
describe('UpdateDianConfigDto — certificate_kms_key_id', () => {
  const errorsFor = (value: unknown) => {
    const dto = plainToInstance(UpdateDianConfigDto, {
      certificate_kms_key_id: value,
    });
    return validateSync(dto).filter(
      (e) => e.property === 'certificate_kms_key_id',
    );
  };

  it.each([
    ['key ARN', 'arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab'],
    ['alias ARN', 'arn:aws:kms:us-east-1:123456789012:alias/vendix-dian-signing'],
    ['bare alias', 'alias/vendix-dian-signing'],
    ['bare key UUID', '1234abcd-12ab-34cd-56ef-1234567890ab'],
    ['govcloud partition', 'arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab'],
  ])('accepts a %s', (_label, value) => {
    expect(errorsFor(value)).toHaveLength(0);
  });

  /**
   * The empty string is the documented way to WITHDRAW the key and go back to
   * in-process custody. Rejecting it would trap a configuration that was migrated
   * by mistake: the bad ARN breaks every signature and there would be no way to
   * remove it from the panel.
   */
  it('accepts the empty string as "withdraw the key"', () => {
    expect(errorsFor('')).toHaveLength(0);
  });

  it('omits the field entirely without complaining', () => {
    const dto = plainToInstance(UpdateDianConfigDto, {});
    expect(
      validateSync(dto).filter(
        (e) => e.property === 'certificate_kms_key_id',
      ),
    ).toHaveLength(0);
  });

  it.each([
    ['a bare word', 'mi-clave'],
    ['a truncated ARN', 'arn:aws:kms:us-east-1:key/abc'],
    ['an ARN for the wrong service', 'arn:aws:s3:::vendix-certs'],
    ['an account id that is not 12 digits', 'arn:aws:kms:us-east-1:12345:key/1234abcd-12ab-34cd-56ef-1234567890ab'],
    ['a non-hex UUID', 'zzzzabcd-12ab-34cd-56ef-1234567890ab'],
  ])('rejects %s', (_label, value) => {
    const errors = errorsFor(value);
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0].constraints)).toContain(
      'KMS key ARN, alias ARN, alias, or key UUID',
    );
  });

  it('trims surrounding whitespace before validating', () => {
    // Pasting from the AWS console commonly carries a trailing newline, which
    // would otherwise fail the pattern and read as an invalid ARN.
    const dto = plainToInstance(UpdateDianConfigDto, {
      certificate_kms_key_id:
        '  arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab\n',
    });
    expect(
      validateSync(dto).filter((e) => e.property === 'certificate_kms_key_id'),
    ).toHaveLength(0);
    expect(dto.certificate_kms_key_id).toBe(
      'arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab',
    );
  });
});
