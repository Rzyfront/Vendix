import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../audit/audit.service';
import { OnboardingService } from '../onboarding/onboarding.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly onboardingService: OnboardingService,
  ) {}

  async registerOwner(
    registerOwnerDto: RegisterOwnerDto,
    client_info?: { ip_address?: string; user_agent?: string },
  ) {
    const { email, password, first_name, last_name, organization_name } =
      registerOwnerDto as any;

    // Preparar datos críticos antes de la transacción
    const organization_slug = this.generateSlugFromName(organization_name);

    // Verificar si slug de organización ya existe
    const existingOrg = await this.prismaService.organizations.findUnique({
      where: { slug: organization_slug },
    });
    if (existingOrg) {
      throw new ConflictException(
        'Una organización con este nombre ya existe.',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Buscar si ya existe un OWNER con este email con onboarding incompleto
    // IMPORTANTE: Solo considerar owners, NO customers u otros roles
    const existingUser = await this.prismaService.users.findFirst({
      where: {
        email,
        onboarding_completed: false,
        user_roles: {
          some: {
            roles: {
              name: 'owner',
            },
          },
        },
      },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });
    if (existingUser) {
      const existingOrganization =
        await this.prismaService.organizations.findUnique({
          where: { id: existingUser.organization_id },
          select: {
            id: true,
            name: true,
            slug: true,
            email: true,
            state: true,
            created_at: true,
          },
        });

      //Retornar mesaje con informacion del onboarding pendiente
      throw new ConflictException({
        message: 'Ya tienes un onboarding pendiente',
        pendingOnboarding: existingOrganization,
        user: existingUser,
      });
    }

    // Crear organización + usuario + roles en una transacción atómica
    const result = await this.prismaService.$transaction(async (tx) => {
      // Buscar rol owner dentro de la transacción
      const ownerRole = await tx.roles.findFirst({
        where: { name: 'owner' },
      });
      if (!ownerRole) {
        throw new BadRequestException('Rol de owner no encontrado');
      }

      const organization = await tx.organizations.create({
        data: {
          name: organization_name,
          slug: organization_slug,
          email: email,
          state: 'draft', // Organización creada en estado draft hasta completar onboarding
        },
      });

      let user;
      const wasExistingUser = false;

      // Verificar si ya existe usuario en esta organización (doble check)
      const existingUserInOrg = await tx.users.findFirst({
        where: { email, organization_id: organization.id },
      });
      if (existingUserInOrg) {
        throw new ConflictException(
          'Ya existe un usuario con este email en la organización',
        );
      }

      // Verificar si existe un usuario con mismo email pero como CUSTOMER
      // En este caso, permitir crear el OWNER (diferente organización)
      const existingCustomer = await tx.users.findFirst({
        where: {
          email,
          user_roles: {
            some: {
              roles: {
                name: 'customer',
              },
            },
          },
        },
        include: {
          user_roles: {
            include: {
              roles: true,
            },
          },
          organizations: true,
        },
      });

      if (existingCustomer) {
        // Es un customer en otra organización, permitir crear owner
        console.log(
          `Creando owner para email ${email} (customer existente en org: ${existingCustomer.organizations?.name})`,
        );
      }

      // Crear nuevo usuario
      user = await tx.users.create({
        data: {
          email,
          password: hashedPassword,
          first_name,
          last_name,
          username: await this.generateUniqueUsername(email),
          email_verified: false,
          organization_id: organization.id,
          onboarding_completed: false,
        },
      });
      // Crear user_settings para el owner con config app ORG_ADMIN
      await tx.user_settings.create({
        data: {
          user_id: user.id,
          config: {
            app: 'ORG_ADMIN',
            panel_ui: {
              stores: true,
              users: true,
              dashboard: true,
              orders: true,
              analytics: true,
              reports: true,
              inventory: true,
              billing: true,
              ecommerce: true,
              audit: true,
              settings: true,
            },
          },
        },
      });

      // Asignar rol owner al usuario (si no lo tiene ya)
      const existingUserRole = await tx.user_roles.findFirst({
        where: { user_id: user.id, role_id: ownerRole.id },
      });
      if (!existingUserRole) {
        await tx.user_roles.create({
          data: { user_id: user.id, role_id: ownerRole.id },
        });
      }

      return { organization, user, wasExistingUser };
    });

    const user = result.user;

    // Obtener usuario con roles incluidos
    const userWithRoles = await this.prismaService.users.findUnique({
      where: { id: user.id },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
        // organization_users removed in schema; use organization_id on users
      },
    });

    if (!userWithRoles) {
      throw new BadRequestException('Error al crear usuario owner');
    }

    // Registrar auditoría para creación de organización
    await this.auditService.logCreate(
      userWithRoles.id,
      AuditResource.ORGANIZATIONS,
      result.organization.id,
      {
        name: result.organization.name,
        slug: result.organization.slug,
        email: result.organization.email,
      },
      {
        registration_type: result.wasExistingUser
          ? 'existing_user'
          : 'new_user',
        ip_address: client_info?.ip_address,
        user_agent: client_info?.user_agent,
      },
    );

    // Registrar auditoría para creación/actualización de usuario
    await this.auditService.logCreate(
      userWithRoles.id,
      AuditResource.USERS,
      userWithRoles.id,
      {
        email: userWithRoles.email,
        first_name: userWithRoles.first_name,
        last_name: userWithRoles.last_name,
        organization_id: userWithRoles.organization_id,
      },
      {
        registration_type: result.wasExistingUser
          ? 'existing_user_assigned'
          : 'new_registration',
        ip_address: client_info?.ip_address,
        user_agent: client_info?.user_agent,
      },
    );

    // Generar tokens
    const tokens = await this.generateTokens(userWithRoles, {
      organization_id: result.organization.id,
      store_id: null,
    });
    await this.createUserSession(userWithRoles.id, tokens.refresh_token, {
      ip_address: client_info?.ip_address || '127.0.0.1',
      user_agent: client_info?.user_agent || 'Registration-Device',
    });

    // Registrar intento de login exitoso
    await this.logLoginAttempt(userWithRoles.id, true);

    // Generar token de verificación de email
    const verificationToken = this.generateRandomToken();

    // Guardar token de verificación en la base de datos
    await this.prismaService.email_verification_tokens.create({
      data: {
        user_id: userWithRoles.id,
        token: verificationToken,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas
      },
    });

    // Enviar email de verificación
    try {
      await this.emailService.sendVerificationEmail(
        userWithRoles.email,
        verificationToken,
        `${userWithRoles.first_name} ${userWithRoles.last_name}`,
      );
      console.log(`✅ Email de verificación enviado a: ${userWithRoles.email}`);
    } catch (error) {
      console.error('❌ Error enviando email de verificación:', error);
      // No fallar el registro si el email no se puede enviar
    }

    // Remover password del response
    const { password: _, ...userWithoutPassword } = userWithRoles;

    return {
      user: userWithoutPassword,
      ...tokens,
      wasExistingUser: result.wasExistingUser,
    };
  }

  async registerCustomer(
    registerCustomerDto: RegisterCustomerDto,
    client_info?: { ip_address?: string; user_agent?: string },
    app: string = 'STORE_ECOMMERCE',
  ) {
    const { email, password, first_name, last_name, store_id } =
      registerCustomerDto;

    // Buscar la tienda por ID
    const store = await this.prismaService.stores.findUnique({
      where: { id: store_id },
    });
    if (!store) {
      throw new BadRequestException('Tienda no encontrada');
    }

    // Verificar si el usuario ya existe en la tienda
    const existingUser = await this.prismaService.users.findFirst({
      where: {
        email,
        organization_id: store.organization_id,
      },
    });
    if (existingUser) {
      throw new ConflictException(
        'El usuario con este email ya existe en esta organización/tienda',
      );
    }

    // Buscar rol customer
    const customerRole = await this.prismaService.roles.findFirst({
      where: { name: 'customer' },
    });
    if (!customerRole) {
      throw new BadRequestException('Rol customer no encontrado');
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // Crear usuario (no hay store_id directo en users; se asocia en store_users)
    const user = await this.prismaService.users.create({
      data: {
        email,
        password: hashedPassword,
        first_name,
        last_name,
        username: await this.generateUniqueUsername(email),
        email_verified: false,
        organization_id: store.organization_id,
      },
    });

    // Crear user_settings para el usuario customer
    let panel_ui = {};
    if (app === 'ORG_ADMIN') {
      panel_ui = {
        stores: true,
        users: true,
        dashboard: true,
        orders: true,
        analytics: true,
        reports: true,
        inventory: true,
        billing: true,
        ecommerce: true,
        audit: true,
        settings: true,
      };
    } else if (app === 'STORE_ADMIN') {
      panel_ui = {
        pos: true,
        users: true,
        dashboard: true,
        analytics: true,
        reports: true,
        billing: true,
        ecommerce: true,
        settings: true,
      };
    } else if (app === 'STORE_ECOMMERCE') {
      panel_ui = {
        profile: true,
        history: true,
        dashboard: true,
        favorites: true,
        orders: true,
        settings: true,
      };
    }
    await this.prismaService.user_settings.create({
      data: {
        user_id: user.id,
        config: { app, panel_ui },
      },
    });

    // Asignar rol customer al usuario
    await this.prismaService.user_roles.create({
      data: {
        user_id: user.id,
        role_id: customerRole.id,
      },
    });

    // Asociar al usuario con la tienda mediante store_users
    await this.prismaService.store_users.create({
      data: {
        store_id: store.id,
        user_id: user.id,
      },
    });

    // Obtener usuario con roles incluidos
    const userWithRoles = await this.prismaService.users.findFirst({
      where: { id: user.id },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!userWithRoles) {
      throw new BadRequestException('Error al crear usuario customer');
    }

    // Generar tokens
    const tokens = await this.generateTokens(userWithRoles, {
      organization_id: store.organization_id,
      store_id: null,
    });
    await this.createUserSession(userWithRoles.id, tokens.refresh_token, {
      ip_address: client_info?.ip_address || '127.0.0.1',
      user_agent: client_info?.user_agent || 'Registration-Device',
    });

    // Registrar intento de login exitoso
    await this.logLoginAttempt(userWithRoles.id, true);

    // Registrar auditoría de creación de cliente
    await this.auditService.logCreate(
      userWithRoles.id,
      AuditResource.USERS,
      userWithRoles.id,
      {
        email: userWithRoles.email,
        first_name: userWithRoles.first_name,
        last_name: userWithRoles.last_name,
        role: 'customer',
        store_id: store.id,
        organization_id: store.organization_id,
      },
      {
        store_id: store.id,
        organization_id: store.organization_id,
        registration_method: 'store_registration',
      },
    );

    // Generar token de verificación de email
    const verificationToken = this.generateRandomToken();

    // Guardar token de verificación en la base de datos
    await this.prismaService.email_verification_tokens.create({
      data: {
        user_id: userWithRoles.id,
        token: verificationToken,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas
      },
    });

    // Enviar email de bienvenida y verificación
    try {
      await this.emailService.sendVerificationEmail(
        userWithRoles.email,
        verificationToken,
        `${userWithRoles.first_name} ${userWithRoles.last_name}`,
      );
      await this.emailService.sendWelcomeEmail(
        userWithRoles.email,
        userWithRoles.first_name,
      );
      console.log(
        `✅ Email de verificación y bienvenida enviado a: ${userWithRoles.email}`,
      );
    } catch (error) {
      console.error(
        '❌ Error enviando email de verificación/bienvenida:',
        error,
      );
      // No fallar el registro si el email no se puede enviar
    }

    // Remover password del response
    const { password: _, ...userWithoutPassword } = userWithRoles;

    return {
      user: userWithoutPassword,
      ...tokens,
    };
  }

  async registerStaff(
    registerStaffDto: RegisterStaffDto,
    admin_user_id: number,
    app: string = 'STORE_ADMIN',
  ) {
    const { email, password, first_name, last_name, role, store_id } =
      registerStaffDto;

    // Verificar que el usuario admin tenga permisos
    const adminUser = await this.prismaService.users.findUnique({
      where: { id: admin_user_id },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    if (!adminUser) {
      throw new NotFoundException('Usuario administrador no encontrado');
    }

    // Verificar que el admin tenga rol de owner, admin o super_admin
    const hasPermission = adminUser.user_roles.some(
      (ur) =>
        ur.roles?.name === 'owner' ||
        ur.roles?.name === 'admin' ||
        ur.roles?.name === 'super_admin',
    );

    if (!hasPermission) {
      throw new UnauthorizedException(
        'No tienes permisos para crear usuarios staff',
      );
    }

    // Obtener organización del admin
    const adminOrganization = await this.prismaService.organizations.findFirst({
      where: { id: adminUser.organization_id },
    });

    if (!adminOrganization) {
      throw new BadRequestException(
        'Organización del administrador no encontrada',
      );
    }

    // Verificar si el usuario ya existe en la organización
    const existingUser = await this.prismaService.users.findFirst({
      where: {
        email,
        organization_id: adminUser.organization_id,
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'El usuario con este email ya existe en esta organización',
      );
    }

    // Verificar rol válido (solo roles de staff que puede asignar un admin)
    const validRoles = ['manager', 'supervisor', 'employee'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(
        `Rol inválido. Roles válidos: ${validRoles.join(', ')}`,
      );
    }

    // Buscar rol en la base de datos
    const staffRole = await this.prismaService.roles.findFirst({
      where: { name: role },
    });

    if (!staffRole) {
      throw new BadRequestException(
        `Rol '${role}' no encontrado en la base de datos`,
      );
    }

    // Verificar store si se proporciona
    if (store_id) {
      const store = await this.prismaService.stores.findFirst({
        where: {
          id: store_id,
          organization_id: adminUser.organization_id,
        },
      });

      if (!store) {
        throw new BadRequestException(
          'Tienda no encontrada o no pertenece a tu organización',
        );
      }
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // Crear usuario
    const user = await this.prismaService.users.create({
      data: {
        email,
        password: hashedPassword,
        first_name,
        last_name,
        username: await this.generateUniqueUsername(email),
        organization_id: adminUser.organization_id,
        email_verified: true, // Staff creado por admin, email ya verificado
        state: 'active',
      },
    });

    // Crear user_settings para el usuario staff
    let panel_ui = {};
    if (app === 'ORG_ADMIN') {
      panel_ui = {
        stores: true,
        users: true,
        dashboard: true,
        orders: true,
        analytics: true,
        reports: true,
        inventory: true,
        billing: true,
        ecommerce: true,
        audit: true,
        settings: true,
      };
    } else if (app === 'STORE_ADMIN') {
      panel_ui = {
        pos: true,
        users: true,
        dashboard: true,
        analytics: true,
        reports: true,
        billing: true,
        ecommerce: true,
        settings: true,
      };
    } else if (app === 'STORE_ECOMMERCE') {
      panel_ui = {
        profile: true,
        history: true,
        dashboard: true,
        favorites: true,
        orders: true,
        settings: true,
      };
    }
    await this.prismaService.user_settings.create({
      data: {
        user_id: user.id,
        config: { app, panel_ui },
      },
    });

    // Asignar rol
    await this.prismaService.user_roles.create({
      data: {
        user_id: user.id,
        role_id: staffRole.id,
      },
    });

    // Asignar a tienda si se especificó
    if (store_id) {
      await this.prismaService.store_users.create({
        data: {
          store_id,
          user_id: user.id,
        },
      });
    }

    // Obtener usuario con roles incluidos
    const userWithRoles = await this.prismaService.users.findFirst({
      where: { id: user.id },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Registrar auditoría
    await this.auditService.logCreate(
      admin_user_id,
      AuditResource.USERS,
      user.id,
      {
        email,
        first_name,
        last_name,
        role,
        store_id,
        created_by: admin_user_id,
      },
      {
        description: `Usuario staff creado por administrador ${adminUser.email}`,
      },
    );

    // Remover password del response (no es necesario ya que no se incluye en la query)
    const userWithoutPassword = userWithRoles;

    return {
      message: `Usuario ${role} creado exitosamente`,
      user: userWithoutPassword,
    };
  }

  async login(
    loginDto: LoginDto,
    client_info?: { ip_address?: string; user_agent?: string },
  ) {
    const { email, password, organization_slug, store_slug } = loginDto;

    // Validar que se proporcione al menos uno de los dos
    if (!organization_slug && !store_slug) {
      throw new BadRequestException(
        'Debe proporcionar organization_slug o store_slug',
      );
    }

    // Buscar usuario con rol y permisos
    const user = await this.prismaService.users.findFirst({
      where: { email },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
        organizations: true,
      },
    });

    if (!user) {
      await this.logLoginAttempt(null, false, email);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // ✅ Validar que el usuario no esté suspended o archived
    if (user.state === 'suspended' || user.state === 'archived') {
      await this.logLoginAttempt(user.id, false);
      throw new UnauthorizedException('Cuenta suspendida o archivada');
    }

    // Validar que el usuario pertenezca a la organización o tienda especificada
    let target_organization_id: number | null = null;
    let target_store_id: number | null = null;
    let login_context: string = '';

    if (organization_slug) {
      // Verificar que el usuario pertenezca a la organización especificada
      if (user.organization_id) {
        const userOrganization =
          await this.prismaService.organizations.findUnique({
            where: { id: user.organization_id },
          });

        if (!userOrganization || userOrganization.slug !== organization_slug) {
          await this.logLoginAttempt(user.id, false);
          throw new UnauthorizedException(
            'Usuario no pertenece a la organización especificada',
          );
        }

        target_organization_id = userOrganization.id;
        login_context = `organization:${organization_slug}`;
      } else {
        await this.logLoginAttempt(user.id, false);
        throw new UnauthorizedException(
          'Usuario no pertenece a ninguna organización',
        );
      }
    } else if (store_slug) {
      // Verificar que el usuario tenga acceso a la tienda especificada
      const storeUser = await this.prismaService.store_users.findFirst({
        where: {
          user_id: user.id,
          store: { slug: store_slug },
        },
        include: {
          store: {
            include: {
              organizations: true,
            },
          },
        },
      });

      if (!storeUser) {
        await this.logLoginAttempt(user.id, false);
        throw new UnauthorizedException(
          'Usuario no tiene acceso a la tienda especificada',
        );
      }

      target_organization_id = storeUser.store.organizations.id;
      target_store_id = storeUser.store.id;
      login_context = `store:${store_slug}`;
    }

    // Verificar si la cuenta está bloqueada
    if (user.locked_until && new Date() < user.locked_until) {
      throw new UnauthorizedException('Cuenta temporalmente bloqueada');
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      // Registrar auditoría de login fallido
      await this.auditService.logAuth(
        user.id,
        AuditAction.LOGIN_FAILED,
        {
          email: user.email,
          reason: 'Invalid credentials',
          attempt_number: user.failed_login_attempts + 1,
        },
        client_info?.ip_address || '127.0.0.1',
        client_info?.user_agent || 'Unknown',
      );

      // Incrementar intentos fallidos
      await this.handleFailedLogin(user.id, client_info);
      await this.logLoginAttempt(user.id, false);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Reset intentos fallidos en login exitoso
    if (user.failed_login_attempts > 0) {
      await this.prismaService.users.update({
        where: { id: user.id },
        data: {
          failed_login_attempts: 0,
          locked_until: null,
        },
      });
    }

    // Generar tokens
    const tokens = await this.generateTokens(user, {
      organization_id: target_organization_id!,
      store_id: target_store_id,
    });

    // Crear refresh token en la base de datos con información del dispositivo
    await this.createUserSession(user.id, tokens.refresh_token, {
      ip_address: client_info?.ip_address || '127.0.0.1',
      user_agent: client_info?.user_agent || 'Login-Device',
    });

    // Registrar intento de login exitoso
    await this.logLoginAttempt(user.id, true);

    // Registrar auditoría de login
    await this.auditService.logAuth(
      user.id,
      AuditAction.LOGIN,
      {
        login_method: 'password',
        success: true,
        login_context: login_context,
        organization_id: target_organization_id,
        store_id: target_store_id,
      },
      client_info?.ip_address || '127.0.0.1',
      client_info?.user_agent || 'Login-Device',
    );

    // Actualizar último login
    await this.prismaService.users.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    // Obtener user_settings
    const userSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: user.id },
    });

    // Remover password del response
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      user_settings: userSettings,
      ...tokens,
    };
  }

  async refreshToken(
    refreshTokenDto: RefreshTokenDto,
    client_info?: {
      ip_address?: string;
      user_agent?: string;
    },
  ): Promise<{
    user: any;
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  }> {
    const { refresh_token } = refreshTokenDto;

    try {
      // Obtener el secret del refresh token
      const refreshSecret =
        this.configService.get<string>('JWT_REFRESH_SECRET') ||
        this.configService.get<string>('JWT_SECRET') ||
        'your-super-secret-jwt-key';

      // Verificar el refresh token con el secret correcto
      const payload = this.jwtService.verify(refresh_token, {
        secret: refreshSecret,
      });

      // Hashear el refresh token recibido para comparación
      const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);

      // Buscar refresh token activo por hash
      const tokenRecord = await this.prismaService.refresh_tokens.findFirst({
        where: {
          token: hashedRefreshToken,
          expires_at: {
            gt: new Date(),
          },
        },
        include: {
          users: {
            include: {
              user_roles: {
                include: {
                  roles: {
                    include: {
                      role_permissions: {
                        include: {
                          permissions: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!tokenRecord) {
        throw new UnauthorizedException('Refresh token inválido o expirado');
      }

      // 🔒 VALIDACIONES DE SEGURIDAD ADICIONALES
      await this.validateRefreshTokenSecurity(tokenRecord, client_info);

      // Generar nuevos tokens
      const tokens = await this.generateTokens(tokenRecord.users, {
        organization_id: payload.organization_id,
        store_id: payload.store_id,
      });

      // El password no está incluido en esta consulta por seguridad
      const userWithoutPassword = tokenRecord.users;

      // Actualizar el refresh token en la base de datos
      const refreshTokenExpiry =
        this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
      const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);

      await this.prismaService.refresh_tokens.update({
        where: { id: tokenRecord.id },
        data: {
          token: tokens.refresh_token,
          expires_at: new Date(Date.now() + expiryMs),
          // Actualizar información de seguridad
          ip_address: client_info?.ip_address || tokenRecord.ip_address,
          user_agent: client_info?.user_agent || tokenRecord.user_agent,
          last_used: new Date(),
        },
      });

      return {
        user: userWithoutPassword,
        ...tokens,
      };
    } catch (error) {
      // Log intento sospechoso
      console.error('🚨 Intento de refresh token sospechoso:', {
        error: error.message,
        client_info,
        timestamp: new Date().toISOString(),
      });

      throw new UnauthorizedException('Token de refresco inválido');
    }
  }

  async getProfile(userId: number) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    // Remover password del response
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async logout(
    user_id: number,
    refresh_token?: string,
    all_sessions: boolean = false,
  ) {
    const now = new Date();

    if (all_sessions) {
      // Cerrar todas las sesiones activas del usuario
      const result = await this.prismaService.refresh_tokens.updateMany({
        where: {
          user_id: user_id,
          revoked: false,
          expires_at: { gt: now },
        },
        data: {
          revoked: true,
          revoked_at: now,
        },
      });

      // Registrar auditoría
      await this.auditService.logAuth(user_id, AuditAction.LOGOUT, {
        action: 'logout_all_sessions',
        sessions_revoked: result.count,
      });

      return {
        message: `Se cerraron ${result.count} sesiones activas.`,
        data: { sessions_revoked: result.count },
      };
    }

    if (refresh_token) {
      // Hashear el refresh token para comparación
      const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);

      // Revocar solo el token específico de la sesión actual
      try {
        const result = await this.prismaService.refresh_tokens.updateMany({
          where: {
            user_id: user_id,
            token: hashedRefreshToken,
            revoked: false,
          },
          data: {
            revoked: true,
            revoked_at: now,
          },
        });

        if (result.count === 0) {
          return {
            message: 'Sesión no encontrada o ya revocada.',
            data: { sessions_revoked: 0 },
          };
        }

        // Registrar auditoría
        await this.auditService.logAuth(user_id, AuditAction.LOGOUT, {
          action: 'logout_single_session',
          sessions_revoked: result.count,
        });

        return {
          message: 'Logout exitoso.',
          data: { sessions_revoked: result.count },
        };
      } catch (error) {
        console.error('Error during logout:', error);
        throw new BadRequestException(
          'No se pudo cerrar la sesión. Intenta de nuevo.',
        );
      }
    }

    return {
      message:
        'No se proporcionó refresh token. Use all_sessions: true para cerrar todas las sesiones.',
      data: { sessions_revoked: 0 },
    };
  }

  // ===== FUNCIONES DE VERIFICACIÓN DE EMAIL =====

  async sendEmailVerification(userId: number): Promise<void> {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.email_verified) {
      throw new BadRequestException('El email ya está verificado');
    }

    // Invalidar tokens anteriores
    await this.prismaService.email_verification_tokens.updateMany({
      where: { user_id: userId, verified: false },
      data: { verified: true }, // Los marcamos como usados
    });

    // Crear nuevo token
    const token = this.generateRandomToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Expira en 24 horas

    await this.prismaService.email_verification_tokens.create({
      data: {
        user_id: userId,
        token,
        expires_at: expiresAt,
      },
    });

    // Enviar email de verificación
    await this.emailService.sendVerificationEmail(
      user.email,
      token,
      user.first_name,
    );

    // También enviamos email de bienvenida después del registro
    await this.emailService.sendWelcomeEmail(user.email, user.first_name);
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const verificationToken =
      await this.prismaService.email_verification_tokens.findUnique({
        where: { token },
        include: { users: true },
      });

    if (!verificationToken) {
      throw new BadRequestException('Token de verificación inválido');
    }

    if (verificationToken.verified) {
      throw new BadRequestException('Token ya utilizado');
    }

    if (new Date() > verificationToken.expires_at) {
      throw new BadRequestException('Token expirado');
    }

    // Marcar token como usado
    await this.prismaService.email_verification_tokens.update({
      where: { id: verificationToken.id },
      data: { verified: true },
    });

    // Marcar email como verificado y activar usuario
    await this.prismaService.users.update({
      where: { id: verificationToken.user_id },
      data: {
        email_verified: true,
        state: 'active', // Activar usuario al verificar email
      },
    });

    return { message: 'Email verificado exitosamente' };
  }

  async resendEmailVerification(email: string): Promise<{ message: string }> {
    const user = await this.prismaService.users.findFirst({
      where: { email },
    });

    if (!user) {
      // Por seguridad, siempre devolvemos el mismo mensaje para evitar enumeración
      return {
        message:
          'Si el email existe y no está verificado, recibirás un nuevo email de verificación',
      };
    }

    if (user.email_verified) {
      throw new BadRequestException('El email ya está verificado');
    }

    await this.sendEmailVerification(user.id);

    return { message: 'Email de verificación enviado' };
  }

  // ===== FUNCIONES DE RECUPERACIÓN DE CONTRASEÑA =====

  async forgotPassword(
    email: string,
    organization_slug: string,
  ): Promise<{ message: string }> {
    // Validar que la organización existe
    const organization = await this.prismaService.organizations.findUnique({
      where: { slug: organization_slug },
    });

    if (!organization) {
      // Por seguridad, devolvemos el mismo mensaje genérico
      return {
        message:
          'Si el email y organización existen, recibirás instrucciones para restablecer tu contraseña',
      };
    }

    // Buscar usuario específico en la organización
    const user = await this.prismaService.users.findFirst({
      where: {
        email,
        organization_id: organization.id,
      },
    });

    // Por seguridad, siempre devolvemos el mismo mensaje
    if (!user) {
      return {
        message:
          'Si el email y organización existen, recibirás instrucciones para restablecer tu contraseña',
      };
    }

    // Invalidar tokens anteriores
    await this.prismaService.password_reset_tokens.updateMany({
      where: { user_id: user.id },
      data: { used: true },
    });

    // Crear nuevo token
    const token = this.generateRandomToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Expira en 1 hora

    await this.prismaService.password_reset_tokens.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expiresAt,
      },
    });

    // Enviar email de recuperación de contraseña
    await this.emailService.sendPasswordResetEmail(
      user.email,
      token,
      user.first_name,
    );

    // Registrar auditoría de solicitud de recuperación
    await this.auditService.logAuth(
      user.id,
      AuditAction.PASSWORD_RESET,
      {
        method: 'forgot_password_request',
        success: true,
        email_sent: true,
      },
      undefined, // IP no disponible en este contexto
      undefined, // User-Agent no disponible en este contexto
    );

    return {
      message:
        'Si el email existe, recibirás instrucciones para restablecer tu contraseña',
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const resetToken =
      await this.prismaService.password_reset_tokens.findUnique({
        where: { token },
        include: { users: true },
      });

    if (!resetToken) {
      throw new BadRequestException('Token de restablecimiento inválido');
    }

    if (resetToken.used) {
      throw new BadRequestException('Token ya utilizado');
    }

    if (new Date() > resetToken.expires_at) {
      throw new BadRequestException(
        'Token expirado. Solicita un nuevo enlace de recuperación.',
      );
    }

    // Verificar que el usuario aún existe y está activo
    if (!resetToken.users || resetToken.users.state !== 'active') {
      throw new BadRequestException('Usuario no encontrado o cuenta inactiva');
    }

    // Validar fortaleza de la nueva contraseña
    if (!this.validatePasswordStrength(newPassword)) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas y números',
      );
    }

    // Verificar que la nueva contraseña no sea igual a la actual
    const isSamePassword = await bcrypt.compare(
      newPassword,
      resetToken.users.password,
    );
    if (isSamePassword) {
      throw new BadRequestException(
        'La nueva contraseña no puede ser igual a la contraseña actual',
      );
    }

    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Actualizar contraseña y marcar token como usado
    await this.prismaService.$transaction([
      this.prismaService.password_reset_tokens.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
      this.prismaService.users.update({
        where: { id: resetToken.user_id },
        data: {
          password: hashedPassword,
          failed_login_attempts: 0,
          locked_until: null,
        },
      }),
    ]);

    // Invalidar todas las sesiones activas - eliminar todos los refresh tokens
    await this.prismaService.refresh_tokens.deleteMany({
      where: { user_id: resetToken.user_id },
    });

    // Registrar auditoría de reset de contraseña
    await this.auditService.logAuth(
      resetToken.user_id,
      AuditAction.PASSWORD_RESET,
      {
        method: 'password_reset_token',
        success: true,
        token_used: true,
      },
      undefined, // IP no disponible en este contexto
      undefined, // User-Agent no disponible en este contexto
    );

    return { message: 'Contraseña restablecida exitosamente' };
  }

  async changePassword(
    user_id: number,
    current_password: string,
    new_password: string,
  ): Promise<{ message: string }> {
    const user = await this.prismaService.users.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Verificar contraseña actual
    const isCurrentPasswordValid = await bcrypt.compare(
      current_password,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Contraseña actual incorrecta');
    }

    // Validar fortaleza de la nueva contraseña
    if (!this.validatePasswordStrength(new_password)) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas y números',
      );
    }

    // Verificar que la nueva contraseña no sea igual a la actual
    const isSamePassword = await bcrypt.compare(new_password, user.password);
    if (isSamePassword) {
      throw new BadRequestException(
        'La nueva contraseña no puede ser igual a la contraseña actual',
      );
    }

    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Actualizar contraseña
    await this.prismaService.users.update({
      where: { id: user_id },
      data: { password: hashedPassword },
    });

    // Invalidar todas las sesiones activas del usuario (seguridad adicional)
    await this.prismaService.refresh_tokens.deleteMany({
      where: { user_id: user_id },
    });

    // Registrar auditoría de cambio de contraseña
    await this.auditService.logAuth(
      user_id,
      AuditAction.PASSWORD_CHANGE,
      {
        method: 'current_password_verification',
        success: true,
        sessions_invalidated: true,
      },
      undefined, // IP no disponible en este contexto
      undefined, // User-Agent no disponible en este contexto
    );

    return {
      message:
        'Contraseña cambiada exitosamente. Todas las sesiones han sido invalidadas por seguridad.',
    };
  }

  // Método auxiliar para verificar tokens de cambio de contraseña (para futura implementación)
  async verifyPasswordChangeToken(token: string): Promise<{ message: string }> {
    // Este método puede implementarse más adelante si se decide agregar verificación por email
    throw new BadRequestException('Funcionalidad no implementada aún');
  }

  // ===== FUNCIONES DE SUPER ADMIN =====

  async verifyUserEmailAsSuperAdmin(
    targetUserId: number,
    superAdminId: number,
  ): Promise<{ message: string; user: any }> {
    // Verificar que el super admin tenga permisos
    const superAdmin = await this.prismaService.users.findUnique({
      where: { id: superAdminId },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    if (!superAdmin) {
      throw new NotFoundException('Super administrador no encontrado');
    }

    // Verificar que sea super admin
    const isSuperAdmin = superAdmin.user_roles.some(
      (ur) => ur.roles?.name === 'super_admin',
    );

    if (!isSuperAdmin) {
      throw new UnauthorizedException(
        'No tienes permisos para realizar esta acción',
      );
    }

    // Buscar el usuario objetivo
    const targetUser = await this.prismaService.users.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (targetUser.email_verified) {
      throw new BadRequestException('El email del usuario ya está verificado');
    }

    // Marcar email como verificado
    const updatedUser = await this.prismaService.users.update({
      where: { id: targetUserId },
      data: {
        email_verified: true,
        state: 'active', // Activar usuario si estaba inactivo
        updated_at: new Date(),
      },
    });

    // Invalidar tokens de verificación de email pendientes
    await this.prismaService.email_verification_tokens.updateMany({
      where: { user_id: targetUserId, verified: false },
      data: { verified: true },
    });

    // Registrar auditoría
    await this.auditService.logUpdate(
      superAdminId,
      AuditResource.USERS,
      targetUserId,
      { email_verified: false, state: targetUser.state },
      { email_verified: true, state: 'active' },
      {
        action: 'super_admin_email_verification',
        verified_by: superAdminId,
        verified_by_email: superAdmin.email,
      },
    );

    // Remover password del response
    const { password, ...userWithoutPassword } = updatedUser;

    return {
      message: 'Email verificado exitosamente por super administrador',
      user: userWithoutPassword,
    };
  }

  // Método auxiliar para validar fortaleza de contraseña
  private validatePasswordStrength(password: string): boolean {
    // Mínimo 8 caracteres, al menos una mayúscula, una minúscula, un número
    const minLength = password.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);

    return minLength && hasUpperCase && hasLowerCase && hasNumbers;
  }

  // ===== FUNCIONES DE ORGANIZACIÓN DESPUÉS DEL REGISTRO =====

  async canCreateOrganization(user_id: number): Promise<boolean> {
    const status =
      await this.onboardingService.getUserOnboardingStatus(user_id);
    return status.can_create_organization;
  }

  async getOnboardingStatus(user_id: number): Promise<{
    email_verified: boolean;
    can_create_organization: boolean;
    has_organization: boolean;
    organization_id?: number;
    next_step: string;
  }> {
    return this.onboardingService.getUserOnboardingStatus(user_id);
  }

  async createOrganizationDuringOnboarding(
    user_id: number,
    organization_data: any,
  ): Promise<{
    success: boolean;
    message: string;
    organization?: any;
    nextStep?: string;
  }> {
    // Verificar que el usuario puede crear organización
    const canCreate = await this.canCreateOrganization(user_id);
    if (!canCreate) {
      throw new BadRequestException(
        'No puedes crear una organización en este momento',
      );
    }

    // Crear la organización
    const organization = await this.prismaService.organizations.create({
      data: {
        ...organization_data,
        slug:
          organization_data.slug ||
          this.generateSlugFromName(organization_data.name),
        updated_at: new Date(),
      },
    });

    // Asignar el usuario a la organización como propietario
    // Primero obtenemos el rol de owner
    const ownerRole = await this.prismaService.roles.findFirst({
      where: { name: 'owner' },
    });

    if (!ownerRole) {
      throw new BadRequestException('Rol de propietario no encontrado');
    }

    // Actualizar user para asociarlo a la organización
    await this.prismaService.users.update({
      where: { id: user_id },
      data: { organization_id: organization.id },
    });

    // Asegurar que el usuario tenga el role owner
    const existingUserRole = await this.prismaService.user_roles.findFirst({
      where: { user_id: user_id, role_id: ownerRole.id },
    });
    if (!existingUserRole) {
      await this.prismaService.user_roles.create({
        data: { user_id: user_id, role_id: ownerRole.id },
      });
    }

    return {
      success: true,
      message: 'Organización creada exitosamente',
      organization,
      nextStep: 'setup_organization',
    };
  }

  async setupOrganization(
    user_id: number,
    organization_id: number,
    setup_data: any,
  ): Promise<{
    success: boolean;
    message: string;
    nextStep?: string;
  }> {
    // Verificar que el usuario tiene permisos en la organización
    const user = await this.prismaService.users.findUnique({
      where: { id: user_id },
      include: { user_roles: { include: { roles: true } } },
    });

    if (!user || user.organization_id !== organization_id) {
      throw new BadRequestException(
        'No tienes permisos para configurar esta organización',
      );
    }

    const roleNames = user.user_roles.map((ur) => ur.roles?.name);
    if (!roleNames.includes('owner') && !roleNames.includes('admin')) {
      throw new BadRequestException(
        'No tienes permisos para configurar esta organización',
      );
    }

    // Separar datos de organización de datos de dirección
    const {
      address_line1,
      address_line2,
      city,
      state_province,
      postal_code,
      country_code,
      ...organization_data
    } = setup_data;

    // Actualizar la organización con los datos de configuración (sin campos de dirección)
    const updatedOrg = await this.prismaService.organizations.update({
      where: { id: organization_id },
      data: {
        ...organization_data,
        updated_at: new Date(),
      },
    });

    // Si hay datos de dirección, crear/actualizar la dirección
    if (setup_data.address_line1) {
      await this.createOrUpdateOrganizationAddress(organization_id, {
        address_line1: setup_data.address_line1,
        address_line2: setup_data.address_line2,
        city: setup_data.city,
        state_province: setup_data.state_province,
        postal_code: setup_data.postal_code,
        country_code: setup_data.country_code,
        type: 'headquarters',
        is_primary: true,
      });
    }

    return {
      success: true,
      message: 'Organización configurada exitosamente',
      nextStep: 'create_store',
    };
  }

  async createStoreDuringOnboarding(
    user_id: number,
    organization_id: number,
    store_data: any,
  ): Promise<{
    success: boolean;
    message: string;
    store?: any;
    nextStep?: string;
  }> {
    // Verificar que el usuario tiene permisos en la organización
    const user = await this.prismaService.users.findUnique({
      where: { id: user_id },
      include: { user_roles: { include: { roles: true } } },
    });

    if (!user || user.organization_id !== organization_id) {
      throw new BadRequestException(
        'No tienes permisos para crear tiendas en esta organización',
      );
    }

    const roleNames = user.user_roles.map((ur) => ur.roles?.name);
    if (!roleNames.includes('owner') && !roleNames.includes('admin')) {
      throw new BadRequestException(
        'No tienes permisos para crear tiendas en esta organización',
      );
    }

    // Separar datos de tienda de datos de configuración y dirección
    const {
      address_line1,
      address_line2,
      city,
      state_province,
      postal_code,
      country_code,
      phone,
      email,
      currency_code,
      timezone,
      track_inventory,
      allow_backorders,
      low_stock_threshold,
      enable_shipping,
      free_shipping_threshold,
      enable_cod,
      enable_online_payments,
      ...storeFields
    } = store_data;

    // Crear la tienda con campos básicos
    try {
      const store = await this.prismaService.stores.create({
        data: {
          ...storeFields,
          organization_id: organization_id,
          manager_user_id: user_id,
          slug: store_data.slug || this.generateSlugFromName(store_data.name),
          is_active: true,
          updated_at: new Date(),
        },
      });

      // Crear configuraciones de la tienda (usando el storeData completo)
      await this.createOrUpdateStoreSettings(store.id, store_data);

      // Si hay datos de dirección, crear/actualizar la dirección
      if (address_line1) {
        await this.createOrUpdateStoreAddress(store.id, {
          address_line1,
          address_line2,
          city,
          state_province,
          postal_code,
          country_code,
          phone_number: phone,
          type: 'store_physical',
          is_primary: true,
        });
      }

      return {
        success: true,
        message: 'Tienda creada y configurada exitosamente',
        store,
        nextStep: 'complete',
      };
    } catch (error) {
      console.error('[ONBOARDING STORE ERROR]', error);
      throw new BadRequestException(
        'Error al crear la tienda durante el onboarding',
        error.message,
      );
    }
  }

  async setupStore(
    user_id: number,
    store_id: number,
    setup_data: any,
  ): Promise<{
    success: boolean;
    message: string;
    nextStep?: string;
  }> {
    // Verificar que el usuario tiene permisos en la tienda
    const store = await this.prismaService.stores.findUnique({
      where: { id: store_id },
    });

    if (!store) {
      throw new NotFoundException('Tienda no encontrada');
    }

    // Verificar que el usuario pertenece a la misma organización
    const userForStore = await this.prismaService.users.findUnique({
      where: { id: user_id },
      include: { user_roles: { include: { roles: true } } },
    });

    if (
      !userForStore ||
      userForStore.organization_id !== store.organization_id
    ) {
      throw new BadRequestException(
        'No tienes permisos para configurar esta tienda',
      );
    }

    const roleNames = userForStore.user_roles.map((ur) => ur.roles?.name);
    if (!roleNames.includes('owner') && !roleNames.includes('admin')) {
      throw new BadRequestException(
        'No tienes permisos para configurar esta tienda',
      );
    }

    // Separar datos de tienda de datos de dirección
    const {
      address_line1,
      address_line2,
      city,
      state_province,
      postal_code,
      country_code,
      phone,
      email,
      description,
      currency_code,
      track_inventory,
      allow_backorders,
      low_stock_threshold,
      enable_shipping,
      free_shipping_threshold,
      enable_cod,
      enable_online_payments,
      ...storeSettings
    } = setup_data;

    // Actualizar configuraciones básicas de la tienda (solo campos válidos)
    const validStoreFields = {
      timezone: storeSettings.timezone,
      store_type: storeSettings.store_type,
    };

    await this.prismaService.stores.update({
      where: { id: store_id },
      data: {
        ...validStoreFields,
        updated_at: new Date(),
      },
    });

    // Crear/actualizar configuraciones de la tienda
    await this.createOrUpdateStoreSettings(store_id, setup_data);

    // Si hay datos de dirección, crear/actualizar la dirección
    if (address_line1) {
      await this.createOrUpdateStoreAddress(store_id, {
        address_line1,
        address_line2,
        city,
        state_province,
        postal_code,
        country_code,
        phone_number: phone,
        type: 'store_physical',
        is_primary: true,
      });
    }

    return {
      success: true,
      message: 'Tienda configurada exitosamente',
      nextStep: 'complete',
    };
  }

  async completeOnboarding(user_id: number): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    const onboardingStatus = await this.getOnboardingStatus(user_id);

    if (
      !onboardingStatus.email_verified ||
      !onboardingStatus.has_organization
    ) {
      throw new BadRequestException('Onboarding no completado correctamente');
    }

    // Validar todas las pre-condiciones requeridas
    const validationResult = await this.validateOnboardingCompletion(user_id);
    if (!validationResult.isValid) {
      throw new BadRequestException(
        `Faltan datos requeridos: ${validationResult.missingFields.join(', ')}`,
      );
    }

    // Actualizar el estado del usuario como onboarding completado
    const updatedUser = await this.prismaService.users.update({
      where: { id: user_id },
      data: {
        onboarding_completed: true,
        updated_at: new Date(),
      },
    });

    // Cambiar el estado de la organización de draft a active
    await this.prismaService.organizations.update({
      where: { id: updatedUser.organization_id },
      data: {
        state: 'active',
        updated_at: new Date(),
      },
    });

    // Registrar auditoría
    await this.auditService.logUpdate(
      user_id,
      AuditResource.USERS,
      user_id,
      { onboarding_completed: false },
      { onboarding_completed: true },
      {
        action: 'complete_onboarding',
        completed_at: new Date().toISOString(),
      },
    );

    return {
      success: true,
      message: 'Onboarding completado exitosamente',
      data: {
        ...onboardingStatus,
        current_step: 'complete',
        onboarding_completed: true,
      },
    };
  }

  // ===== MÉTODO AUXILIAR PARA VALIDACIONES =====

  private async validateOnboardingCompletion(user_id: number): Promise<{
    isValid: boolean;
    missingFields: string[];
  }> {
    const missingFields: string[] = [];

    // Obtener datos del usuario con organización
    const user = await this.prismaService.users.findUnique({
      where: { id: user_id },
      include: {
        organizations: {
          include: {
            addresses: true,
            stores: {
              include: {
                addresses: true,
              },
            },
            domain_settings: true,
          },
        },
      },
    });

    if (!user) {
      missingFields.push('usuario no encontrado');
      return { isValid: false, missingFields };
    }

    // 0. Validar que el usuario NO haya completado ya el onboarding
    if (user.onboarding_completed) {
      missingFields.push('onboarding ya completado');
      return { isValid: false, missingFields };
    }

    if (!user.organizations) {
      missingFields.push('organización');
      return { isValid: false, missingFields };
    }

    const organization = user.organizations;

    // 1. Validar datos básicos de organización
    if (!organization.name || !organization.description) {
      missingFields.push('nombre y descripción de organización');
    }

    if (!organization.email || !organization.phone) {
      missingFields.push('email y teléfono de organización');
    }

    // 2. Validar dirección de organización
    if (!organization.addresses || organization.addresses.length === 0) {
      missingFields.push('dirección de organización');
    } else {
      const primaryAddress = organization.addresses.find(
        (addr) => addr.is_primary,
      );
      if (
        !primaryAddress ||
        !primaryAddress.address_line1 ||
        !primaryAddress.city ||
        !primaryAddress.country_code
      ) {
        missingFields.push('dirección completa de organización');
      }
    }

    // 3. Validar que existe al menos una tienda
    if (!organization.stores || organization.stores.length === 0) {
      missingFields.push('al menos una tienda configurada');
    } else {
      // Validar que la tienda tenga datos básicos
      const store = organization.stores[0];
      if (!store.name) {
        missingFields.push('nombre de tienda');
      }

      // Validar dirección de tienda
      if (!store.addresses || store.addresses.length === 0) {
        missingFields.push('dirección de tienda');
      }
    }

    // 4. Validar configuración de dominio
    if (
      !organization.domain_settings ||
      organization.domain_settings.length === 0
    ) {
      missingFields.push('configuración de dominio');
    } else {
      const domainSetting = organization.domain_settings[0];

      // Validar hostname
      if (!domainSetting.hostname) {
        missingFields.push('hostname en domain_settings');
      }

      // Validar colores en config JSON
      if (!domainSetting.config) {
        missingFields.push('configuración de colores en domain_settings');
      } else {
        try {
          const config =
            typeof domainSetting.config === 'string'
              ? JSON.parse(domainSetting.config)
              : domainSetting.config;

          const colors: string[] = [];
          if (config.branding?.primaryColor) colors.push('primaryColor');
          if (config.branding?.secondaryColor) colors.push('secondaryColor');

          if (colors.length < 2) {
            missingFields.push(
              'al menos 2 colores (primario y secundario) en domain_settings.config.branding',
            );
          }
        } catch (error) {
          missingFields.push(
            'configuración de colores válida en domain_settings',
          );
        }
      }
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
    };
  }

  // ===== FUNCIONES AUXILIARES PARA ONBOARDING =====

  private async createOrUpdateOrganizationAddress(
    organizationId: number,
    addressData: any,
  ) {
    // Buscar dirección existente
    const existingAddress = await this.prismaService.addresses.findFirst({
      where: {
        organization_id: organizationId,
        is_primary: true,
      },
    });

    if (existingAddress) {
      return await this.prismaService.addresses.update({
        where: { id: existingAddress.id },
        data: {
          ...addressData,
        },
      });
    } else {
      return await this.prismaService.addresses.create({
        data: {
          ...addressData,
          is_primary: true,
        },
      });
    }
  }

  private async createOrUpdateStoreAddress(storeId: number, addressData: any) {
    // Buscar dirección existente
    const existingAddress = await this.prismaService.addresses.findFirst({
      where: {
        store_id: storeId,
        is_primary: true,
      },
    });

    if (existingAddress) {
      return await this.prismaService.addresses.update({
        where: { id: existingAddress.id },
        data: {
          ...addressData,
        },
      });
    } else {
      return await this.prismaService.addresses.create({
        data: {
          ...addressData,
          is_primary: true,
        },
      });
    }
  }

  private async createOrUpdateStoreSettings(
    storeId: number,
    settingsData: any,
  ) {
    // Buscar configuraciones existentes
    const existingSettings = await this.prismaService.store_settings.findFirst({
      where: { store_id: storeId },
    });

    const settingsToSave = {
      currency: settingsData.currency_code,
      timezone: settingsData.timezone,
      language: settingsData.language,
      track_inventory: settingsData.track_inventory,
      allow_backorders: settingsData.allow_backorders,
      low_stock_threshold: settingsData.low_stock_threshold,
      enable_shipping: settingsData.enable_shipping,
      free_shipping_threshold: settingsData.free_shipping_threshold,
      enable_cod: settingsData.enable_cod,
      enable_online_payments: settingsData.enable_online_payments,
    };

    if (existingSettings) {
      return await this.prismaService.store_settings.update({
        where: { id: existingSettings.id },
        data: {
          settings: settingsToSave,
          updated_at: new Date(),
        },
      });
    } else {
      return await this.prismaService.store_settings.create({
        data: {
          store_id: storeId,
          settings: settingsToSave,
        },
      });
    }
  }

  private generateSlugFromName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, '-') // Reemplazar espacios con guiones
      .replace(/-+/g, '-') // Remover guiones múltiples
      .trim();
  }

  // ===== FUNCIONES AUXILIARES =====

  private generateRandomToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  private async generateTokens(
    user: any,
    scope: { organization_id: number; store_id?: number | null },
  ): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  }> {
    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.user_roles.map((r) => r.roles.name),
      permissions: this.getPermissionsFromRoles(user.user_roles),
      organization_id: scope.organization_id,
      store_id: scope.store_id,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret:
        this.configService.get<string>('JWT_REFRESH_SECRET') ||
        this.configService.get<string>('JWT_SECRET'),
      expiresIn:
        this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d',
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.parseExpiryToMilliseconds(
        this.configService.get<string>('JWT_EXPIRES_IN') || '1h',
      ),
    };
  }
  private async createUserSession(
    user_id: number,
    refresh_token: string,
    client_info?: {
      ip_address?: string;
      user_agent?: string;
    },
  ) {
    // Obtener duración del refresh token del entorno
    const refreshTokenExpiry =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);

    // Generar fingerprint del dispositivo
    const device_fingerprint = this.generateDeviceFingerprint(client_info);

    // Hashear el refresh token para almacenamiento seguro
    const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);

    await this.prismaService.refresh_tokens.create({
      data: {
        user_id: user_id,
        token: hashedRefreshToken, // Guardar hash en lugar del token en claro
        expires_at: new Date(Date.now() + expiryMs),
        ip_address: client_info?.ip_address || null,
        user_agent: client_info?.user_agent || null,
        device_fingerprint: device_fingerprint,
        last_used: new Date(),
        revoked: false,
      },
    });
  }

  private async handleFailedLogin(
    user_id: number,
    client_info?: { ip_address?: string; user_agent?: string },
  ) {
    const user = await this.prismaService.users.findUnique({
      where: { id: user_id },
    });

    if (!user) return;

    const failed_attempts = user.failed_login_attempts + 1;
    const updateData: any = { failed_login_attempts: failed_attempts };

    // Bloquear cuenta después de 5 intentos fallidos por 30 minutos
    if (failed_attempts >= 5) {
      updateData.locked_until = new Date(Date.now() + 30 * 60 * 1000);

      // Registrar auditoría de bloqueo de cuenta
      await this.auditService.logAuth(
        user_id,
        AuditAction.ACCOUNT_LOCKED,
        {
          reason: 'Too many failed login attempts',
          failed_attempts: failed_attempts,
          locked_until: updateData.locked_until,
        },
        client_info?.ip_address || '127.0.0.1',
        client_info?.user_agent || 'Unknown',
      );
    }

    await this.prismaService.users.update({
      where: { id: user_id },
      data: updateData,
    });
  }
  private async logLoginAttempt(
    user_id: number | null,
    successful: boolean,
    email?: string,
  ) {
    // Obtener el email del usuario si no se proporciona
    let emailToLog = email;
    if (!emailToLog && user_id) {
      const user = await this.prismaService.users.findUnique({
        where: { id: user_id },
        select: { email: true },
      });
      emailToLog = user?.email || '';
    }

    // Determinar store_id requerido por el modelo login_attempts
    let store_id_to_log: number | null = null;
    if (user_id) {
      // Buscar relación store_users
      const su = await this.prismaService.store_users.findFirst({
        where: { user_id: user_id },
      });
      if (su) store_id_to_log = su.store_id;

      // Si no hay store_users, intentar obtener una tienda de la organización del usuario
      if (!store_id_to_log) {
        const user = await this.prismaService.users.findUnique({
          where: { id: user_id },
        });
        if (user) {
          const store = await this.prismaService.stores.findFirst({
            where: { organization_id: user.organization_id },
          });
          if (store) store_id_to_log = store.id;
        }
      }
    }

    // Fallback: si no encontramos ninguna tienda, usar null (se manejará en el schema)
    if (!store_id_to_log) {
      store_id_to_log = null; // No hay store disponible
    }

    // Solo crear el login attempt si tenemos un store_id válido
    if (store_id_to_log) {
      await this.prismaService.login_attempts.create({
        data: {
          email: emailToLog || '',
          store_id: store_id_to_log,
          success: successful,
          ip_address: '', // Se puede obtener del request en el controller
          user_agent: '', // Se puede obtener del request en el controller
          failure_reason: successful ? null : 'Invalid credentials',
        },
      });
    }
  }

  async validateUser(user_id: number) {
    const user = await this.prismaService.users.findUnique({
      where: { id: user_id },
      include: {
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getUserSessions(user_id: number) {
    const sessions = await this.prismaService.refresh_tokens.findMany({
      where: {
        user_id: user_id,
        revoked: false,
        expires_at: { gt: new Date() },
      },
      orderBy: { last_used: 'desc' },
      select: {
        id: true,
        device_fingerprint: true,
        ip_address: true,
        user_agent: true,
        last_used: true,
        created_at: true,
      },
    });

    // Parsear información del dispositivo para cada sesión
    return sessions.map((session) => ({
      id: session.id,
      device: this.parseDeviceInfo(session.user_agent || ''),
      ipAddress: session.ip_address,
      lastUsed: session.last_used,
      created_at: session.created_at,
      isCurrentSession: false, // TODO: Implementar lógica para identificar sesión actual
    }));
  }

  async revokeUserSession(user_id: number, session_id: number) {
    // Verificar que la sesión pertenece al usuario
    const session = await this.prismaService.refresh_tokens.findFirst({
      where: {
        id: session_id,
        user_id: user_id,
        revoked: false,
      },
    });

    if (!session) {
      throw new NotFoundException(
        'Sesión no encontrada o no pertenece al usuario',
      );
    }

    // Revocar la sesión
    await this.prismaService.refresh_tokens.update({
      where: { id: session_id },
      data: { revoked: true },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId: user_id,
      action: AuditAction.UPDATE,
      resource: AuditResource.USERS,
      resourceId: user_id,
      oldValues: { session_active: true },
      newValues: { session_active: false },
      metadata: {
        session_id: session_id,
        action: 'revoke_session',
      },
      ipAddress: session.ip_address || undefined,
      userAgent: session.user_agent || undefined,
    });

    return {
      message: 'Sesión revocada exitosamente',
      data: { session_revoked: session_id },
    };
  }

  // Método auxiliar para convertir duraciones JWT a segundos
  private parseExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 900; // Default: 15 minutos
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 24 * 60 * 60;
      default:
        return 900; // Default: 15 minutos
    }
  }

  // Método auxiliar para convertir duraciones JWT a milisegundos
  private parseExpiryToMilliseconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 7 * 24 * 60 * 60 * 1000; // Default: 7 días
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000; // Default: 7 días
    }
  }

  // 🔒 VALIDACIONES DE SEGURIDAD PARA REFRESH TOKEN
  private async validateRefreshTokenSecurity(
    tokenRecord: any,
    client_info?: { ip_address?: string; user_agent?: string },
  ): Promise<void> {
    // Si no hay información del cliente, permitir (compatibilidad con versiones anteriores)
    if (!client_info) {
      console.warn('⚠️ Refresh token usado sin información del cliente');
      return;
    }

    const config = {
      strictIpCheck:
        this.configService.get<boolean>('STRICT_IP_CHECK') || false,
      strictDeviceCheck:
        this.configService.get<boolean>('STRICT_DEVICE_CHECK') || true,
      allowCrossDevice:
        this.configService.get<boolean>('ALLOW_CROSS_DEVICE_REFRESH') || false,
    };

    // 🔍 VERIFICAR IP ADDRESS
    if (tokenRecord.ip_address && client_info.ip_address) {
      if (tokenRecord.ip_address !== client_info.ip_address) {
        console.warn('🚨 IP Address mismatch:', {
          stored: tokenRecord.ip_address,
          current: client_info.ip_address,
          userId: tokenRecord.user_id,
          timestamp: new Date().toISOString(),
        });

        if (config.strictIpCheck) {
          throw new UnauthorizedException(
            'Token usage from different IP address detected',
          );
        }
      }
    }

    // 🔍 VERIFICAR DEVICE FINGERPRINT (Más importante que IP)
    if (tokenRecord.device_fingerprint && client_info.user_agent) {
      const current_fingerprint = this.generateDeviceFingerprint(client_info);

      if (tokenRecord.device_fingerprint !== current_fingerprint) {
        const storedBrowser = this.extractBrowserFromUserAgent(
          tokenRecord.user_agent || '',
        );
        const currentBrowser = this.extractBrowserFromUserAgent(
          client_info.user_agent,
        );
        const storedOS = this.extractOSFromUserAgent(
          tokenRecord.user_agent || '',
        );
        const currentOS = this.extractOSFromUserAgent(client_info.user_agent);

        console.error('🚨 DEVICE FINGERPRINT MISMATCH:', {
          userId: tokenRecord.user_id,
          stored: {
            fingerprint: tokenRecord.device_fingerprint,
            browser: storedBrowser,
            os: storedOS,
            ip: tokenRecord.ip_address,
          },
          current: {
            fingerprint: current_fingerprint,
            browser: currentBrowser,
            os: currentOS,
            ip: client_info.ip_address,
          },
          timestamp: new Date().toISOString(),
        });

        if (config.strictDeviceCheck && !config.allowCrossDevice) {
          // Revocar el token sospechoso
          await this.prismaService.refresh_tokens.update({
            where: { id: tokenRecord.id },
            data: {
              revoked: true,
              revoked_at: new Date(),
            },
          });

          throw new UnauthorizedException(
            '🛡️ Token usage from different device detected. For security, please log in again.',
          );
        }
      }
    }

    // 🔍 VERIFICAR FRECUENCIA DE USO
    if (tokenRecord.last_used) {
      const timeSinceLastUse =
        Date.now() - new Date(tokenRecord.last_used).getTime();
      const minTimeBetweenRefresh =
        (this.configService.get<number>('MAX_REFRESH_FREQUENCY') || 30) * 1000;

      if (timeSinceLastUse < minTimeBetweenRefresh) {
        console.warn('🚨 Refresh token being used too frequently:', {
          userId: tokenRecord.user_id,
          timeSinceLastUse: Math.round(timeSinceLastUse / 1000),
          minRequired: Math.round(minTimeBetweenRefresh / 1000),
        });

        throw new UnauthorizedException(
          'Token refresh rate exceeded. Please wait before trying again.',
        );
      }
    }

    // 🔍 VERIFICAR SI EL TOKEN FUE REVOCADO
    if (tokenRecord.revoked) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // ✅ Log exitoso para monitoreo
    console.log('✅ Refresh token validation passed:', {
      userId: tokenRecord.user_id,
      clientIP: client_info.ip_address,
      browser: this.extractBrowserFromUserAgent(client_info.user_agent || ''),
      os: this.extractOSFromUserAgent(client_info.user_agent || ''),
      device_matched:
        tokenRecord.device_fingerprint ===
        this.generateDeviceFingerprint(client_info),
      timestamp: new Date().toISOString(),
    });
  }

  // Extraer navegador principal del User Agent
  private extractBrowserFromUserAgent(userAgent: string): string {
    if (!userAgent) return 'unknown';

    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
      return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    if (userAgent.includes('Opera')) return 'Opera';

    return 'other';
  }

  // Generar fingerprint único del dispositivo
  private generateDeviceFingerprint(client_info?: {
    ip_address?: string;
    user_agent?: string;
  }): string {
    if (!client_info) {
      return 'unknown-device';
    }

    // Extraer información básica del User Agent
    const browser = this.extractBrowserFromUserAgent(
      client_info.user_agent || '',
    );
    const os = this.extractOSFromUserAgent(client_info.user_agent || '');

    // Crear fingerprint básico (sin ser invasivo)
    const fingerprint = `${browser}-${os}-${client_info.ip_address?.split('.')[0] || 'unknown'}`;

    // Hash para ofuscar información sensible
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(fingerprint)
      .digest('hex')
      .substring(0, 32);
  }

  // Extraer sistema operativo del User Agent
  private extractOSFromUserAgent(userAgent: string): string {
    if (!userAgent) return 'unknown';

    if (userAgent.includes('Windows NT 10.0')) return 'Windows10';
    if (userAgent.includes('Windows NT')) return 'Windows';
    if (userAgent.includes('Mac OS X')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iPhone') || userAgent.includes('iPad'))
      return 'iOS';

    return 'other';
  }

  // Generar username único basado en email
  private async generateUniqueUsername(email: string): Promise<string> {
    const baseUsername = email.split('@')[0];
    let username = baseUsername;
    let counter = 1;

    // Verificar si el username ya existe
    while (await this.prismaService.users.findFirst({ where: { username } })) {
      username = `${baseUsername}${counter}`;
      counter++;
      // Límite de seguridad para evitar bucles infinitos
      if (counter > 100) {
        // Si hay demasiadas colisiones, agregar timestamp
        username = `${baseUsername}_${Date.now()}`;
        break;
      }
    }

    return username;
  }

  // Parsear información del dispositivo desde User Agent
  private parseDeviceInfo(userAgent: string) {
    if (!userAgent) {
      return {
        browser: 'Unknown',
        os: 'Unknown',
        type: 'Unknown',
      };
    }

    const browser = this.extractBrowserFromUserAgent(userAgent);
    const os = this.extractOSFromUserAgent(userAgent);
    const type = this.detectDeviceType(userAgent);

    return {
      browser,
      os,
      type,
    };
  }

  // Detectar tipo de dispositivo
  private detectDeviceType(userAgent: string): string {
    if (
      userAgent.includes('Mobile') ||
      userAgent.includes('Android') ||
      userAgent.includes('iPhone')
    ) {
      return 'Mobile';
    }
    if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
      return 'Tablet';
    }
    return 'Desktop';
  }

  // Método auxiliar para obtener permisos de roles
  private getPermissionsFromRoles(userRoles: any[]): string[] {
    const permissions = new Set<string>();

    for (const userRole of userRoles) {
      if (userRole.roles?.role_permissions) {
        for (const rolePermission of userRole.roles.role_permissions) {
          if (rolePermission.permissions?.name) {
            permissions.add(rolePermission.permissions.name);
          }
        }
      }
    }

    return Array.from(permissions);
  }
}
