import { validate } from 'class-validator';
import { CompleteWhatsappEmbeddedSignupDto } from './dto';

describe('CompleteWhatsappEmbeddedSignupDto', () => {
  it('rejects an invalid Embedded Signup payload', async () => {
    const dto = new CompleteWhatsappEmbeddedSignupDto();
    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(['code']);
  });

  it('accepts a payload without waba_id and phone_number_id', async () => {
    const dto = new CompleteWhatsappEmbeddedSignupDto();
    dto.code = 'oauth-code';

    expect(await validate(dto)).toHaveLength(0);
  });
});
