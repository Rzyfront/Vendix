import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from './auth.module';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

describe('Contextual Login Flow - Focused Integration Tests', () => {
  let app: INestApplication;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await prismaService.login_attempts.deleteMany();
    await prismaService.refresh_tokens.deleteMany();
    await prismaService.store_users.deleteMany();
    await prismaService.user_roles.deleteMany();
    await prismaService.user_settings.deleteMany();
    await prismaService.users.deleteMany();
    await prismaService.stores.deleteMany();
    await prismaService.organizations.deleteMany();
  });

  describe('Basic Login Scenarios', () => {
    let organization: any;
    let ownerUser: any;

    beforeEach(async () => {
      // Create test organization
      organization = await prismaService.organizations.create({
        data: {
          name: 'Test Organization',
          slug: 'test-org',
          email: 'org@test.com',
          state: 'active',
        },
      });

      // Create test store
      await prismaService.stores.create({
        data: {
          name: 'Test Store',
          slug: 'test-store',
          organization_id: organization.id,
          is_active: true,
        },
      });

      // Get or create owner role
      let ownerRole = await prismaService.roles.findFirst({
        where: { name: 'owner' },
      });

      // If role doesn't exist, create it
      if (!ownerRole) {
        ownerRole = await prismaService.roles.create({
          data: {
            name: 'owner',
            description: 'Propietario de la organización',
            is_system_role: true,
          },
        });
      }

      // Create owner user
      ownerUser = await prismaService.users.create({
        data: {
          email: 'owner@test.com',
          password: await bcrypt.hash('OwnerPass123', 12),
          first_name: 'Owner',
          last_name: 'User',
          username: 'owner@test.com',
          email_verified: true,
          organization_id: organization.id,
        },
      });

      // Assign role
      await prismaService.user_roles.create({
        data: { user_id: ownerUser.id, role_id: ownerRole.id },
      });

      // Create user settings
      await prismaService.user_settings.create({
        data: {
          user_id: ownerUser.id,
          config: { app: 'ORG_ADMIN' },
        },
      });
    });

    it('should successfully login owner with organization slug', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'owner@test.com',
          password: 'OwnerPass123',
          organization_slug: 'test-org',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('owner@test.com');
      expect(response.body.data.user.roles).toContain('owner');
      expect(response.body.data.access_token).toBeDefined();
      expect(response.body.data.refresh_token).toBeDefined();
      expect(response.body.data.user_settings.config.app).toBe('ORG_ADMIN');
    });

    it('should fail login when no organization or store slug provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'owner@test.com',
          password: 'OwnerPass123',
        })
        .expect(400);

      expect(response.body.message).toContain(
        'Debe proporcionar organization_slug o store_slug',
      );
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.statusCode).toBe(400);
    });

    it('should fail login when both organization and store slug provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'owner@test.com',
          password: 'OwnerPass123',
          organization_slug: 'test-org',
          store_slug: 'test-store',
        })
        .expect(400);

      expect(response.body.message).toContain(
        'Proporcione solo organization_slug o store_slug, no ambos',
      );
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.statusCode).toBe(400);
    });
  });

  describe('Security Validations', () => {
    let organization: any;
    let suspendedUser: any;

    beforeEach(async () => {
      organization = await prismaService.organizations.create({
        data: {
          name: 'Security Test Org',
          slug: 'security-org',
          email: 'security@test.com',
          state: 'active',
        },
      });

      // Get or create owner role
      let ownerRole = await prismaService.roles.findFirst({
        where: { name: 'owner' },
      });

      // If role doesn't exist, create it
      if (!ownerRole) {
        ownerRole = await prismaService.roles.create({
          data: {
            name: 'owner',
            description: 'Propietario de la organización',
            is_system_role: true,
          },
        });
      }

      // Suspended user
      suspendedUser = await prismaService.users.create({
        data: {
          email: 'suspended@test.com',
          password: await bcrypt.hash('SuspendedPass123', 12),
          first_name: 'Suspended',
          last_name: 'User',
          username: 'suspended@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'suspended',
        },
      });

      await prismaService.user_roles.create({
        data: { user_id: suspendedUser.id, role_id: ownerRole.id },
      });

      await prismaService.user_settings.create({
        data: {
          user_id: suspendedUser.id,
          config: { app: 'ORG_ADMIN' },
        },
      });
    });

    it('should deny login for suspended user', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'suspended@test.com',
          password: 'SuspendedPass123',
          organization_slug: 'security-org',
        })
        .expect(401);

      expect(response.body.message).toContain('Cuenta suspendida o archivada');
      expect(response.body.error).toBe('Unauthorized');
      expect(response.body.statusCode).toBe(401);
    });
  });
});
