import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { GlobalPrismaService as PrismaService } from '../../prisma/services/global-prisma.service';
import { EmailService } from '../../email/email.service';

describe('Owner Registration Flow - Focused Integration Tests', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let emailService: EmailService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    emailService = moduleFixture.get<EmailService>(EmailService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await prismaService.email_verification_tokens.deleteMany();
    await prismaService.refresh_tokens.deleteMany();
    await prismaService.user_roles.deleteMany();
    await prismaService.user_settings.deleteMany();
    await prismaService.users.deleteMany();
    await prismaService.organizations.deleteMany();
  });

  describe('Complete Owner Registration Flow', () => {
    const validOwnerData = {
      organization_name: 'Integration Test Organization',
      email: 'integration@test.com',
      password: 'Password@123',
      first_name: 'Integration',
      last_name: 'User',
      phone: '+1234567890',
    };

    it('should complete full registration and email verification flow', async () => {
      // Step 1: Register Owner
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send(validOwnerData)
        .expect(201);

      const registerResult = registerResponse.body;
      expect(registerResult.success).toBe(true);
      expect(registerResult.data.user.email).toBe(validOwnerData.email);
      expect(registerResult.data.user.email_verified).toBe(false);
      expect(registerResult.data.user.roles).toContain('owner');
      expect(registerResult.data.access_token).toBeDefined();
      expect(registerResult.data.refresh_token).toBeDefined();

      // Verify organization was created
      const organization = await prismaService.organizations.findFirst({
        where: { email: validOwnerData.email },
      });
      expect(organization).toBeDefined();
      expect(organization!.name).toBe(validOwnerData.organization_name);
      expect(organization!.state).toBe('draft');

      // Verify user was created
      const user = await prismaService.users.findFirst({
        where: { email: validOwnerData.email },
        include: {
          user_roles: {
            include: { roles: true },
          },
        },
      });
      expect(user).toBeDefined();
      expect(user!.first_name).toBe(validOwnerData.first_name);
      expect(user!.last_name).toBe(validOwnerData.last_name);
      expect(user!.email_verified).toBe(false);
      expect(user!.organization_id).toBe(organization!.id);

      // Verify user has owner role
      const hasOwnerRole = user!.user_roles.some(
        (ur) => ur.roles.name === 'owner',
      );
      expect(hasOwnerRole).toBe(true);

      // Verify email verification token was created
      const emailToken =
        await prismaService.email_verification_tokens.findFirst({
          where: { user_id: user!.id },
        });
      expect(emailToken).toBeDefined();
      expect(emailToken!.verified).toBe(false);
      expect(emailToken!.expires_at).toBeInstanceOf(Date);

      // Verify refresh token was created
      const refreshToken = await prismaService.refresh_tokens.findFirst({
        where: { user_id: user!.id },
      });
      expect(refreshToken).toBeDefined();
      expect(refreshToken!.revoked).toBe(false);

      // Step 2: Verify Email
      const verifyResponse = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: emailToken!.token })
        .expect(200);

      const verifyResult = verifyResponse.body;
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.data.message).toBe('Email verificado exitosamente');

      // Verify email was marked as verified
      const updatedUser = await prismaService.users.findUnique({
        where: { id: user!.id },
      });
      expect(updatedUser!.email_verified).toBe(true);
      expect(updatedUser!.state).toBe('active');

      // Verify token was marked as used
      const usedToken =
        await prismaService.email_verification_tokens.findUnique({
          where: { id: emailToken!.id },
        });
      expect(usedToken!.verified).toBe(true);

      // Step 3: Try to verify again with same token (should fail)
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: emailToken!.token })
        .expect(400);

      // Step 4: Try to resend verification (should fail because email is already verified)
      await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: validOwnerData.email })
        .expect(400);
    });

    it('should handle email verification with invalid token', async () => {
      // Register owner first
      await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send(validOwnerData)
        .expect(201);

      // Try to verify with invalid token
      const response = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: 'invalid-token' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Token de verificación inválido');
    });

    it('should handle email verification with expired token', async () => {
      // Register owner first
      await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send(validOwnerData)
        .expect(201);

      // Get user and create an expired token
      const user = await prismaService.users.findFirst({
        where: { email: validOwnerData.email },
      });

      // Create expired token (1 hour ago)
      const expiredDate = new Date(Date.now() - 60 * 60 * 1000);
      await prismaService.email_verification_tokens.create({
        data: {
          user_id: user!.id,
          token: 'expired-token',
          expires_at: expiredDate,
          verified: false,
        },
      });

      // Try to verify with expired token
      const response = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: 'expired-token' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Token expirado');
    });

    it('should handle resend verification for unverified email', async () => {
      // Register owner first
      await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send(validOwnerData)
        .expect(201);

      // Get user and invalidate existing tokens
      const user = await prismaService.users.findFirst({
        where: { email: validOwnerData.email },
      });

      // Resend verification
      const response = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: validOwnerData.email })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain(
        'Email de verificación enviado',
      );

      // Verify old tokens were invalidated
      const oldTokens = await prismaService.email_verification_tokens.findMany({
        where: { user_id: user!.id },
      });
      const verifiedTokens = oldTokens.filter(
        (token) => token.verified === true,
      );
      expect(verifiedTokens.length).toBeGreaterThan(0);

      // Verify new token was created
      const newTokens = oldTokens.filter((token) => token.verified === false);
      expect(newTokens.length).toBe(1);
    });

    it('should handle resend verification for non-existent email gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'nonexistent@test.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain(
        'Si el email existe y no está verificado',
      );
    });

    it('should validate required fields during registration', async () => {
      // Test missing organization name
      const response1 = await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send({
          email: validOwnerData.email,
          password: validOwnerData.password,
          first_name: validOwnerData.first_name,
          last_name: validOwnerData.last_name,
        })
        .expect(400);

      expect(response1.body.success).toBe(false);

      // Test missing email
      const response2 = await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send({
          organization_name: validOwnerData.organization_name,
          password: validOwnerData.password,
          first_name: validOwnerData.first_name,
          last_name: validOwnerData.last_name,
        })
        .expect(400);

      expect(response2.body.success).toBe(false);

      // Test missing password
      const response3 = await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send({
          organization_name: validOwnerData.organization_name,
          email: validOwnerData.email,
          first_name: validOwnerData.first_name,
          last_name: validOwnerData.last_name,
        })
        .expect(400);

      expect(response3.body.success).toBe(false);

      // Test invalid email format
      const response4 = await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send({
          ...validOwnerData,
          email: 'invalid-email',
        })
        .expect(400);

      expect(response4.body.success).toBe(false);

      // Test weak password
      const response5 = await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send({
          ...validOwnerData,
          password: 'weak',
        })
        .expect(400);

      expect(response5.body.success).toBe(false);
    });

    it('should handle organization name conflict during registration', async () => {
      // Create an existing organization
      await prismaService.organizations.create({
        data: {
          name: validOwnerData.organization_name,
          slug: 'integration-test-organization',
          email: 'existing@test.com',
          state: 'active',
        },
      });

      // Try to register with same organization name
      const response = await request(app.getHttpServer())
        .post('/auth/register-owner')
        .send(validOwnerData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain(
        'Una organización con este nombre ya existe',
      );
    });
  });
});
