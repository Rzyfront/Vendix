import { validate } from 'class-validator';
import { CompleteWhatsappEmbeddedSignupDto } from './dto';

describe('CompleteWhatsappEmbeddedSignupDto', () => {
  it('rejects an invalid Embedded Signup payload', async () => {
    const dto = new CompleteWhatsappEmbeddedSignupDto();
    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['code', 'waba_id', 'phone_number_id']),
    );
  });
});
