import { Type, ValidationPipe } from '@nestjs/common';
import { LoginDto } from './login.dto';
import { LoginCustomerDto } from './login-customer.dto';
import { CreateUserDto } from '../../organization/users/dto/create-user.dto';
import { UpdateUserDto } from '../../organization/users/dto/update-user.dto';

describe('Identity email DTOs through the HTTP validation pipe', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const base = {
    email: '  User+POS@Example.COM  ',
    password: 'CaseSafe@123',
  };

  const cases: Array<[Type<unknown>, Record<string, unknown>]> = [
    [LoginDto, base],
    [LoginCustomerDto, { ...base, store_id: 22 }],
    [
      CreateUserDto,
      { ...base, first_name: 'Test', last_name: 'User', username: 'test' },
    ],
    [UpdateUserDto, { email: base.email }],
  ];

  it.each(cases)('normalizes email before validating %p', async (metatype, body) => {
    const value = await pipe.transform(body, { type: 'body', metatype });
    expect(value.email).toBe('user+pos@example.com');
    if ('password' in body) expect(value.password).toBe(body.password);
  });

  it.each([123, {}, ['User@Example.COM'], null, 'not-an-email'])(
    'does not turn invalid email %p into a valid identity',
    async (email) => {
      await expect(
        pipe.transform(
          { ...base, email },
          { type: 'body', metatype: LoginDto },
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
});
