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

  it.each([
    'FINISH',
    'FINISH_ONLY_WABA',
    'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    'FINISH_GRANT_ONLY_API_ACCESS',
  ])('accepts finish_event %s', async (finish_event) => {
    const dto = new CompleteWhatsappEmbeddedSignupDto();
    dto.code = 'oauth-code';
    dto.finish_event = finish_event as any;

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an unknown finish_event', async () => {
    const dto = new CompleteWhatsappEmbeddedSignupDto();
    dto.code = 'oauth-code';
    dto.finish_event = 'CANCEL' as any;

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(['finish_event']);
  });
});
