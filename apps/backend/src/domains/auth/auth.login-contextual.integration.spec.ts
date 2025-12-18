import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { GlobalPrismaService as PrismaService } from '../../prisma/services/global-prisma.service';
import * as bcrypt from 'bcrypt';

describe('Contextual Login Flow - Integration Tests', () => {
  let app: INestApplication;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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
    let store: any;
    let ownerUser: any;
    let staffUser: any;
    let customerUser: any;

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
      store = await prismaService.stores.create({
        data: {
          name: 'Test Store',
          slug: 'test-store',
          organization_id: organization.id,
          state: 'active',
        },
      });

      // Get roles
      const ownerRole = await prismaService.roles.findFirst({
        where: { name: 'owner' },
      });
      const staffRole = await prismaService.roles.findFirst({
        where: { name: 'employee' },
      });
      const customerRole = await prismaService.roles.findFirst({
        where: { name: 'customer' },
      });

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
          state: 'active',
        },
      });

      // Create staff user
      staffUser = await prismaService.users.create({
        data: {
          email: 'staff@test.com',
          password: await bcrypt.hash('StaffPass123', 12),
          first_name: 'Staff',
          last_name: 'User',
          username: 'staff@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'active',
        },
      });

      // Create customer user
      customerUser = await prismaService.users.create({
        data: {
          email: 'customer@test.com',
          password: await bcrypt.hash('CustomerPass123', 12),
          first_name: 'Customer',
          last_name: 'User',
          username: 'customer@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'active',
        },
      });

      // Assign roles
      await prismaService.user_roles.createMany({
        data: [
          { user_id: ownerUser.id, role_id: ownerRole.id },
          { user_id: staffUser.id, role_id: staffRole.id },
          { user_id: customerUser.id, role_id: customerRole.id },
        ],
      });

      // Create user settings
      await prismaService.user_settings.createMany({
        data: [
          {
            user_id: ownerUser.id,
            config: { app: 'ORG_ADMIN' },
          },
          {
            user_id: staffUser.id,
            config: { app: 'STORE_ADMIN' },
          },
          {
            user_id: customerUser.id,
            config: { app: 'STORE_ECOMMERCE' },
          },
        ],
      });

      // Link staff and customer to store
      await prismaService.store_users.createMany({
        data: [
          { store_id: store.id, user_id: staffUser.id },
          { store_id: store.id, user_id: customerUser.id },
        ],
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

    it('should successfully login staff with store slug', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'staff@test.com',
          password: 'StaffPass123',
          store_slug: 'test-store',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('staff@test.com');
      expect(response.body.data.user.roles).toContain('employee');
      expect(response.body.data.access_token).toBeDefined();
      expect(response.body.data.user_settings.config.app).toBe('STORE_ADMIN');
    });

    it('should successfully login customer with store slug', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'customer@test.com',
          password: 'CustomerPass123',
          store_slug: 'test-store',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('customer@test.com');
      expect(response.body.data.user.roles).toContain('customer');
      expect(response.body.data.access_token).toBeDefined();
      expect(response.body.data.user_settings.config.app).toBe(
        'STORE_ECOMMERCE',
      );
    });

    it('should fail login when no organization or store slug provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'owner@test.com',
          password: 'OwnerPass123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain(
        'Debe proporcionar organization_slug o store_slug',
      );
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

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain(
        'Proporcione solo organization_slug o store_slug, no ambos',
      );
    });
  });

  describe('Permission and Access Control Scenarios', () => {
    let organization: any;
    let store1: any;
    let store2: any;
    let ownerUser: any;
    let staffUser: any;

    beforeEach(async () => {
      // Create test organization
      organization = await prismaService.organizations.create({
        data: {
          name: 'Permission Test Org',
          slug: 'permission-org',
          email: 'permission@test.com',
          state: 'active',
        },
      });

      // Create multiple stores
      store1 = await prismaService.stores.create({
        data: {
          name: 'Store 1',
          slug: 'store-1',
          organization_id: organization.id,
          state: 'active',
        },
      });

      store2 = await prismaService.stores.create({
        data: {
          name: 'Store 2',
          slug: 'store-2',
          organization_id: organization.id,
          state: 'active',
        },
      });

      // Get roles
      const ownerRole = await prismaService.roles.findFirst({
        where: { name: 'owner' },
      });
      const staffRole = await prismaService.roles.findFirst({
        where: { name: 'employee' },
      });

      // Create users
      ownerUser = await prismaService.users.create({
        data: {
          email: 'permission-owner@test.com',
          password: await bcrypt.hash('OwnerPass123', 12),
          first_name: 'Permission',
          last_name: 'Owner',
          username: 'permission-owner@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'active',
        },
      });

      staffUser = await prismaService.users.create({
        data: {
          email: 'permission-staff@test.com',
          password: await bcrypt.hash('StaffPass123', 12),
          first_name: 'Permission',
          last_name: 'Staff',
          username: 'permission-staff@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'active',
        },
      });

      // Assign roles
      await prismaService.user_roles.createMany({
        data: [
          { user_id: ownerUser.id, role_id: ownerRole.id },
          { user_id: staffUser.id, role_id: staffRole.id },
        ],
      });

      // Create user settings
      await prismaService.user_settings.createMany({
        data: [
          {
            user_id: ownerUser.id,
            config: { app: 'ORG_ADMIN' },
          },
          {
            user_id: staffUser.id,
            config: { app: 'STORE_ADMIN' },
          },
        ],
      });

      // Link staff only to store 1
      await prismaService.store_users.create({
        data: {
          store_id: store1.id,
          user_id: staffUser.id,
        },
      });
    });

    it('should allow owner to access any store in organization without direct link', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'permission-owner@test.com',
          password: 'OwnerPass123',
          store_slug: 'store-2', // Store where owner has no direct link
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('permission-owner@test.com');
      expect(response.body.data.user.roles).toContain('owner');
    });

    it('should deny staff access to store without direct link', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'permission-staff@test.com',
          password: 'StaffPass123',
          store_slug: 'store-2', // Store where staff has no direct link
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Credenciales inválidas');
    });

    it('should allow staff access to store with direct link', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'permission-staff@test.com',
          password: 'StaffPass123',
          store_slug: 'store-1', // Store where staff has direct link
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('permission-staff@test.com');
    });

    it('should deny access to organization that user does not belong to', async () => {
      // Create another organization
      await prismaService.organizations.create({
        data: {
          name: 'Other Organization',
          slug: 'other-org',
          email: 'other@test.com',
          state: 'active',
        },
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'permission-owner@test.com',
          password: 'OwnerPass123',
          organization_slug: 'other-org', // Different organization
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Credenciales inválidas');
    });
  });

  describe('Security and Validation Scenarios', () => {
    let organization: any;
    let activeUser: any;
    let suspendedUser: any;
    let unverifiedUser: any;

    beforeEach(async () => {
      organization = await prismaService.organizations.create({
        data: {
          name: 'Security Test Org',
          slug: 'security-org',
          email: 'security@test.com',
          state: 'active',
        },
      });

      await prismaService.stores.create({
        data: {
          name: 'Security Store',
          slug: 'security-store',
          organization_id: organization.id,
          state: 'active',
        },
      });

      const ownerRole = await prismaService.roles.findFirst({
        where: { name: 'owner' },
      });

      // Active user
      activeUser = await prismaService.users.create({
        data: {
          email: 'active@test.com',
          password: await bcrypt.hash('ActivePass123', 12),
          first_name: 'Active',
          last_name: 'User',
          username: 'active@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'active',
        },
      });

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

      // Unverified email user
      unverifiedUser = await prismaService.users.create({
        data: {
          email: 'unverified@test.com',
          password: await bcrypt.hash('UnverifiedPass123', 12),
          first_name: 'Unverified',
          last_name: 'User',
          username: 'unverified@test.com',
          email_verified: false,
          organization_id: organization.id,
          state: 'active',
        },
      });

      // Assign roles
      await prismaService.user_roles.createMany({
        data: [
          { user_id: activeUser.id, role_id: ownerRole.id },
          { user_id: suspendedUser.id, role_id: ownerRole.id },
          { user_id: unverifiedUser.id, role_id: ownerRole.id },
        ],
      });

      // Create user settings
      await prismaService.user_settings.createMany({
        data: [
          {
            user_id: activeUser.id,
            config: { app: 'ORG_ADMIN' },
          },
          {
            user_id: suspendedUser.id,
            config: { app: 'ORG_ADMIN' },
          },
          {
            user_id: unverifiedUser.id,
            config: { app: 'ORG_ADMIN' },
          },
        ],
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

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Cuenta suspendida o archivada');
    });

    it('should allow login for user with unverified email', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'unverified@test.com',
          password: 'UnverifiedPass123',
          organization_slug: 'security-org',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email_verified).toBe(false);
    });

    it('should track failed login attempts', async () => {
      // First failed attempt
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'active@test.com',
          password: 'WrongPassword',
          organization_slug: 'security-org',
        })
        .expect(401);

      // Verify login attempt was recorded
      const loginAttempts = await prismaService.login_attempts.findMany({
        where: { user_id: activeUser.id },
      });
      expect(loginAttempts.length).toBe(1);
      expect(loginAttempts[0].success).toBe(false);
    });

    it('should reset failed attempts on successful login', async () => {
      // First, simulate some failed attempts
      await prismaService.users.update({
        where: { id: activeUser.id },
        data: { failed_login_attempts: 3 },
      });

      // Successful login
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'active@test.com',
          password: 'ActivePass123',
          organization_slug: 'security-org',
        })
        .expect(200);

      // Verify failed attempts were reset
      const updatedUser = await prismaService.users.findUnique({
        where: { id: activeUser.id },
      });
      expect(updatedUser.failed_login_attempts).toBe(0);
    });
  });

  describe('App Type Switching Scenarios', () => {
    let organization: any;
    let store: any;
    let ownerUser: any;

    beforeEach(async () => {
      organization = await prismaService.organizations.create({
        data: {
          name: 'App Switch Org',
          slug: 'app-switch-org',
          email: 'appswitch@test.com',
          state: 'active',
        },
      });

      store = await prismaService.stores.create({
        data: {
          name: 'App Switch Store',
          slug: 'app-switch-store',
          organization_id: organization.id,
          state: 'active',
        },
      });

      const ownerRole = await prismaService.roles.findFirst({
        where: { name: 'owner' },
      });

      ownerUser = await prismaService.users.create({
        data: {
          email: 'appswitch@test.com',
          password: await bcrypt.hash('OwnerPass123', 12),
          first_name: 'App',
          last_name: 'Switch',
          username: 'appswitch@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'active',
          main_store_id: store.id,
        },
      });

      await prismaService.user_roles.create({
        data: { user_id: ownerUser.id, role_id: ownerRole.id },
      });

      await prismaService.user_settings.create({
        data: {
          user_id: ownerUser.id,
          config: { app: 'ORG_ADMIN' },
        },
      });

      // Link user to store
      await prismaService.store_users.create({
        data: {
          store_id: store.id,
          user_id: ownerUser.id,
        },
      });
    });

    it('should auto-switch STORE_ADMIN to main_store context when logging with organization slug', async () => {
      // Update user to have STORE_ADMIN app type
      await prismaService.user_settings.update({
        where: { user_id: ownerUser.id },
        data: { config: { app: 'STORE_ADMIN' } },
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'appswitch@test.com',
          password: 'OwnerPass123',
          organization_slug: 'app-switch-org',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user_settings.config.app).toBe('STORE_ADMIN');
    });

    it('should switch ORG_ADMIN to STORE_ADMIN when logging with store slug', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'appswitch@test.com',
          password: 'OwnerPass123',
          store_slug: 'app-switch-store',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user_settings.config.app).toBe('STORE_ADMIN');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    let organization: any;
    let user: any;

    beforeEach(async () => {
      organization = await prismaService.organizations.create({
        data: {
          name: 'Edge Case Org',
          slug: 'edge-case-org',
          email: 'edge@test.com',
          state: 'active',
        },
      });

      await prismaService.stores.create({
        data: {
          name: 'Edge Case Store',
          slug: 'edge-case-store',
          organization_id: organization.id,
          state: 'active',
        },
      });

      const ownerRole = await prismaService.roles.findFirst({
        where: { name: 'owner' },
      });

      user = await prismaService.users.create({
        data: {
          email: 'edge@test.com',
          password: await bcrypt.hash('EdgePass123', 12),
          first_name: 'Edge',
          last_name: 'Case',
          username: 'edge@test.com',
          email_verified: true,
          organization_id: organization.id,
          state: 'active',
        },
      });

      await prismaService.user_roles.create({
        data: { user_id: user.id, role_id: ownerRole.id },
      });

      await prismaService.user_settings.create({
        data: {
          user_id: user.id,
          config: { app: 'ORG_ADMIN' },
        },
      });
    });

    it('should handle non-existent organization slug', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'edge@test.com',
          password: 'EdgePass123',
          organization_slug: 'non-existent-org',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Credenciales inválidas');
    });

    it('should handle non-existent store slug', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'edge@test.com',
          password: 'EdgePass123',
          store_slug: 'non-existent-store',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Credenciales inválidas');
    });

    it('should handle incorrect password', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'edge@test.com',
          password: 'WrongPassword123',
          organization_slug: 'edge-case-org',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Credenciales inválidas');
    });

    it('should handle non-existent user', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'SomePassword123',
          organization_slug: 'edge-case-org',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Credenciales inválidas');
    });

    it('should handle account lockout after multiple failed attempts', async () => {
      // Simulate multiple failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: 'edge@test.com',
            password: 'WrongPassword123',
            organization_slug: 'edge-case-org',
          })
          .expect(401);
      }

      // Check if account is locked
      const updatedUser = await prismaService.users.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser.failed_login_attempts).toBeGreaterThan(0);
    });
  });
});
