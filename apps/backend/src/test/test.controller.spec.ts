import { TestController } from './test.controller';

/**
 * The verification email test creates a token and sends it by email; the
 * HTTP answer reports the delivery without carrying the token.
 */
describe('TestController.testVerificationEmail', () => {
  it('answers with the delivery result and never with the token', async () => {
    const prisma = {
      users: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
      email_verification_tokens: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const emailService = {
      sendVerificationEmail: jest
        .fn()
        .mockResolvedValue({ success: true, messageId: 'm-1' }),
    };
    const controller = new TestController(
      emailService as never,
      prisma as never,
      {} as never,
    );

    const answer = await controller.testVerificationEmail({
      email: 'user5@tienda.co',
      username: 'user5',
    });

    const [{ data: created }] = prisma.email_verification_tokens.create.mock.calls[0];
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      'user5@tienda.co',
      created.token,
      'user5',
      undefined,
    );
    expect(answer.data).toEqual({ success: true, messageId: 'm-1', userId: 5 });
    expect(JSON.stringify(answer)).not.toContain(created.token);
  });
});
