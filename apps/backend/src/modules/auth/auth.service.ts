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
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async registerOwner(registerOwnerDto: RegisterOwnerDto, clientInfo?: { ipAddress?: string; userAgent?: string }) {
    const { email, password, first_name, last_name, organizationName } = registerOwnerDto as any;

    // Preparar datos críticos antes de la transacción
    const organizationSlug = this.generateSlugFromName(organizationName);

    // Verificar si slug de organización ya existe
    const existingOrg = await this.prismaService.organizations.findUnique({
      where: { slug: organizationSlug },
    });
    if (existingOrg) {
      throw new ConflictException('Una organización con este nombre ya existe.');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Buscar si ya existe un usuario con este email con onboarding incompleto
    const existingUser = await this.prismaService.users.findFirst({
      where: {
        email,
        onboarding_completed: false,
      },
    });

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
          name: organizationName,
          slug: organizationSlug,
          email: email,
        },
      });

      let user;
      let wasExistingUser = false;

      if (existingUser) {
        // Actualizar usuario existente: asignar organización y rol owner
        user = await tx.users.update({
          where: { id: existingUser.id },
          data: {
            organization_id: organization.id,
            password: hashedPassword, // Actualizar contraseña si se proporciona nueva
            onboarding_completed: false, // Reset si estaba incompleto
          },
        });
        wasExistingUser = true;
      } else {
        // Verificar si ya existe usuario en esta organización (doble check)
        const existingUserInOrg = await tx.users.findFirst({
          where: { email, organization_id: organization.id },
        });
        if (existingUserInOrg) {
          throw new ConflictException('Ya existe un usuario con este email en la organización');
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
      }

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

    // Generar tokens
    const tokens = await this.generateTokens(userWithRoles);
    await this.createUserSession(userWithRoles.id, tokens.refresh_token, {
      ipAddress: clientInfo?.ipAddress || '127.0.0.1',
      userAgent: clientInfo?.userAgent || 'Registration-Device',
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

  async registerCustomer(registerCustomerDto) {
    const { email, password, first_name, last_name, store_slug } = registerCustomerDto;

    // Buscar la tienda por slug
    const store = await this.prismaService.stores.findFirst({
      where: { slug: store_slug },
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
      throw new ConflictException('El usuario con este email ya existe en esta organización/tienda');
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
    const tokens = await this.generateTokens(userWithRoles);
    await this.createUserSession(userWithRoles.id, tokens.refresh_token, {
      ipAddress: '127.0.0.1', // TODO: Obtener IP real del request
      userAgent: 'Registration-Device', // TODO: Obtener User-Agent real del request
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

  async register(registerDto: RegisterDto) {
    const { email, password, first_name, last_name, organization_id } = registerDto;

    // Verificar si el usuario ya existe en la organización
    const existingUser = await this.prismaService.users.findFirst({
      where: {
        email,
        organization_id: organization_id ?? undefined,
      },
    });
    if (existingUser) {
      throw new ConflictException('El usuario con este email ya existe en esta organización');
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // Buscar rol por defecto (customer)
    const defaultRole = await this.prismaService.roles.findFirst({
      where: { name: 'customer' },
    });

    if (!defaultRole) {
      throw new BadRequestException('Rol por defecto no encontrado');
    }

    // Crear usuario
    const user = await this.prismaService.users.create({
      data: {
        email,
        password: hashedPassword,
        first_name,
        last_name,
        username: await this.generateUniqueUsername(email), // Usar la parte antes del @ como username
        email_verified: false,
        organization_id: organization_id ?? 1, // fallback temporal si no se provee (mejor pasar explícito)
      },
    });

    // Asignar rol por defecto al usuario
    await this.prismaService.user_roles.create({
      data: {
        user_id: user.id,
        role_id: defaultRole.id,
      },
    });

    // Si se registró desde una tienda (organization_id implicado por store), no hay store_id en users;
    // la relación con tiendas se realiza en `store_users` cuando corresponde.

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
      },
    });

    if (!userWithRoles) {
      throw new BadRequestException('Error al crear usuario');
    }

    // Generar tokens
    const tokens = await this.generateTokens(userWithRoles); // Crear refresh token en la base de datos con información del dispositivo
    await this.createUserSession(userWithRoles.id, tokens.refresh_token, {
      ipAddress: '127.0.0.1', // TODO: Obtener IP real del request
      userAgent: 'Registration-Device', // TODO: Obtener User-Agent real del request
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
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

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
      },
    });

    if (!user) {
      await this.logLoginAttempt(null, false, email);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar si la cuenta está bloqueada
    if (user.locked_until && new Date() < user.locked_until) {
      throw new UnauthorizedException('Cuenta temporalmente bloqueada');
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      // Incrementar intentos fallidos
      await this.handleFailedLogin(user.id);
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
    const tokens = await this.generateTokens(user);

    // Crear refresh token en la base de datos con información del dispositivo
    await this.createUserSession(user.id, tokens.refresh_token, {
      ipAddress: '127.0.0.1', // TODO: Obtener IP real del request
      userAgent: 'Login-Device', // TODO: Obtener User-Agent real del request
    });

    // Registrar intento de login exitoso
    await this.logLoginAttempt(user.id, true);

    // Actualizar último login
    await this.prismaService.users.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    // Remover password del response
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      ...tokens,
    };
  }

  async refreshToken(
    refreshTokenDto: RefreshTokenDto,
    clientInfo?: {
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
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
      });      if (!tokenRecord) {
        throw new UnauthorizedException('Refresh token inválido o expirado');
      }

      // 🔒 VALIDACIONES DE SEGURIDAD ADICIONALES
      await this.validateRefreshTokenSecurity(tokenRecord, clientInfo);

      // Generar nuevos tokens
      const tokens = await this.generateTokens(tokenRecord.users);

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
          ip_address: clientInfo?.ipAddress || tokenRecord.ip_address,
          user_agent: clientInfo?.userAgent || tokenRecord.user_agent,
          last_used: new Date(),
        },
      });

      return tokens;
    } catch (error) {
      // Log intento sospechoso
      console.error('🚨 Intento de refresh token sospechoso:', {
        error: error.message,
        clientInfo,
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

  async logout(userId: number, refreshToken?: string) {
    // Revocar refresh tokens del usuario
    const now = new Date();
    if (refreshToken) {
      // Hashear el refresh token para comparación
      const hashedRefreshToken = await bcrypt.hash(refreshToken, 12);

      // Revocar solo el token específico de la sesión actual
      try {
        const result = await this.prismaService.refresh_tokens.updateMany({
          where: {
            user_id: userId,
            token: hashedRefreshToken,
            revoked: false,
          },
          data: {
            revoked: true,
            revoked_at: now,
          },
        });
        if (result.count === 0) {
          return { message: 'Sesion no encontrada' };
        }
        return { message: 'Logout exitoso' };
      } catch (error) {
        // Loguear el error para auditoría
        throw new BadRequestException(
          'No se pudo cerrar la sesión. Intenta de nuevo.',
        );
      }
    }
    return { message: 'No se proporcionó refresh token para revocar.' };
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

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.prismaService.users.findFirst({
      where: { email },
    });

    // Por seguridad, siempre devolvemos el mismo mensaje
    if (!user) {
      return {
        message:
          'Si el email existe, recibirás instrucciones para restablecer tu contraseña',
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
      throw new BadRequestException('Token expirado');
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

    return { message: 'Contraseña restablecida exitosamente' };
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Verificar contraseña actual
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Contraseña actual incorrecta');
    }

    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Actualizar contraseña
    await this.prismaService.users.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Contraseña cambiada exitosamente' };
  }

  // ===== FUNCIONES DE ORGANIZACIÓN DESPUÉS DEL REGISTRO =====

  async canCreateOrganization(userId: number): Promise<boolean> {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        user_roles: { include: { roles: true } },
      },
    });

    if (!user || !user.email_verified) {
      return false;
    }

    // Verificar si ya es propietario de alguna organización mediante user_roles
    const isOwner = (user.user_roles || []).some((ur) => ur.roles?.name === 'owner');

    return !isOwner; // Solo puede crear si no es propietario de otra
  }

  async getOnboardingStatus(userId: number): Promise<{
    emailVerified: boolean;
    canCreateOrganization: boolean;
    hasOrganization: boolean;
    organizationId?: number;
    nextStep: string;
  }> {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        user_roles: { include: { roles: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const emailVerified = user.email_verified;
  const hasOrganization = !!user.organization_id;
  const canCreateOrganization = await this.canCreateOrganization(userId);

    let nextStep = '';
    if (!emailVerified) {
      nextStep = 'verify_email';
    } else if (!hasOrganization) {
      nextStep = 'create_organization';
    } else {
      nextStep = 'complete_setup';
    }

    return {
      emailVerified,
      canCreateOrganization,
      hasOrganization,
      organizationId: user.organization_id,
      nextStep,
    };
  }

  // ===== FUNCIONES DE ONBOARDING COMPLETO =====

  async startOnboarding(userId: number): Promise<{
    status: string;
    currentStep: string;
    message: string;
    data?: any;
  }> {
    const onboardingStatus = await this.getOnboardingStatus(userId);

    return {
      status: 'success',
      currentStep: onboardingStatus.nextStep,
      message: 'Estado de onboarding obtenido',
      data: onboardingStatus,
    };
  }

  async createOrganizationDuringOnboarding(
    userId: number,
    organizationData: any,
  ): Promise<{
    success: boolean;
    message: string;
    organization?: any;
    nextStep?: string;
  }> {
    // Verificar que el usuario puede crear organización
    const canCreate = await this.canCreateOrganization(userId);
    if (!canCreate) {
      throw new BadRequestException(
        'No puedes crear una organización en este momento',
      );
    }

    // Crear la organización
    const organization = await this.prismaService.organizations.create({
      data: {
        ...organizationData,
        slug:
          organizationData.slug ||
          this.generateSlugFromName(organizationData.name),
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
      where: { id: userId },
      data: { organization_id: organization.id },
    });

    // Asegurar que el usuario tenga el role owner
    const existingUserRole = await this.prismaService.user_roles.findFirst({
      where: { user_id: userId, role_id: ownerRole.id },
    });
    if (!existingUserRole) {
      await this.prismaService.user_roles.create({
        data: { user_id: userId, role_id: ownerRole.id },
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
    userId: number,
    organizationId: number,
    setupData: any,
  ): Promise<{
    success: boolean;
    message: string;
    nextStep?: string;
  }> {
    // Verificar que el usuario tiene permisos en la organización
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: { user_roles: { include: { roles: true } } },
    });

    if (!user || user.organization_id !== organizationId) {
      throw new BadRequestException('No tienes permisos para configurar esta organización');
    }

    const roleNames = user.user_roles.map((ur) => ur.roles?.name);
    if (!roleNames.includes('owner') && !roleNames.includes('admin')) {
      throw new BadRequestException('No tienes permisos para configurar esta organización');
    }

    // Actualizar la organización con los datos de configuración
    const updatedOrg = await this.prismaService.organizations.update({
      where: { id: organizationId },
      data: {
        ...setupData,
        updated_at: new Date(),
      },
    });

    // Si hay datos de dirección, crear/actualizar la dirección
    if (setupData.address_line1) {
      await this.createOrUpdateOrganizationAddress(organizationId, {
        address_line1: setupData.address_line1,
        address_line2: setupData.address_line2,
        city: setupData.city,
        state_province: setupData.state_province,
        postal_code: setupData.postal_code,
        country_code: setupData.country_code,
        type: 'business',
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
    userId: number,
    organizationId: number,
    storeData: any,
  ): Promise<{
    success: boolean;
    message: string;
    store?: any;
    nextStep?: string;
  }> {
    // Verificar que el usuario tiene permisos en la organización
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: { user_roles: { include: { roles: true } } },
    });

    if (!user || user.organization_id !== organizationId) {
      throw new BadRequestException('No tienes permisos para crear tiendas en esta organización');
    }

    const roleNames2 = user.user_roles.map((ur) => ur.roles?.name);
    if (!roleNames2.includes('owner') && !roleNames2.includes('admin')) {
      throw new BadRequestException('No tienes permisos para crear tiendas en esta organización');
    }

    // Crear la tienda
    const store = await this.prismaService.stores.create({
      data: {
        ...storeData,
        organization_id: organizationId,
        manager_id: userId,
        slug: storeData.slug || this.generateSlugFromName(storeData.name),
        is_active: true,
        updated_at: new Date(),
      },
    });

    return {
      success: true,
      message: 'Tienda creada exitosamente',
      store,
      nextStep: 'setup_store',
    };
  }

  async setupStore(
    userId: number,
    storeId: number,
    setupData: any,
  ): Promise<{
    success: boolean;
    message: string;
    nextStep?: string;
  }> {
    // Verificar que el usuario tiene permisos en la tienda
    const store = await this.prismaService.stores.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundException('Tienda no encontrada');
    }

    // Verificar que el usuario pertenece a la misma organización
    const userForStore = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: { user_roles: { include: { roles: true } } },
    });

    if (!userForStore || userForStore.organization_id !== store.organization_id) {
      throw new BadRequestException('No tienes permisos para configurar esta tienda');
    }

    const roleNames3 = userForStore.user_roles.map((ur) => ur.roles?.name);
    if (!roleNames3.includes('owner') && !roleNames3.includes('admin')) {
      throw new BadRequestException('No tienes permisos para configurar esta tienda');
    }

    // Actualizar configuraciones básicas de la tienda
    const {
      address_line1,
      address_line2,
      city,
      state_province,
      postal_code,
      country_code,
      phone,
      email,
      ...storeSettings
    } = setupData;

    await this.prismaService.stores.update({
      where: { id: storeId },
      data: {
        ...storeSettings,
        updated_at: new Date(),
      },
    });

    // Crear/actualizar configuraciones de la tienda
    await this.createOrUpdateStoreSettings(storeId, setupData);

    // Si hay datos de dirección, crear/actualizar la dirección
    if (address_line1) {
      await this.createOrUpdateStoreAddress(storeId, {
        address_line1,
        address_line2,
        city,
        state_province,
        postal_code,
        country_code,
        phone,
        type: 'business',
        is_primary: true,
      });
    }

    return {
      success: true,
      message: 'Tienda configurada exitosamente',
      nextStep: 'complete',
    };
  }

  async completeOnboarding(userId: number): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    const onboardingStatus = await this.getOnboardingStatus(userId);

    if (!onboardingStatus.emailVerified || !onboardingStatus.hasOrganization) {
      throw new BadRequestException('Onboarding no completado correctamente');
    }

    // Actualizar el estado del usuario como onboarding completado
    // TODO: Agregar campo onboarding_completed al esquema de users
    await this.prismaService.users.update({
      where: { id: userId },
      data: {
        // onboarding_completed: true, // Campo por agregar al esquema
        updated_at: new Date(),
      },
    });

    return {
      success: true,
      message: 'Onboarding completado exitosamente',
      data: {
        ...onboardingStatus,
        currentStep: 'complete',
        onboardingCompleted: true,
      },
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
          updated_at: new Date(),
        },
      });
    } else {
      return await this.prismaService.addresses.create({
        data: {
          ...addressData,
          organization_id: organizationId,
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
          updated_at: new Date(),
        },
      });
    } else {
      return await this.prismaService.addresses.create({
        data: {
          ...addressData,
          store_id: storeId,
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
      currency: settingsData.currency,
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
          ...settingsToSave,
          updated_at: new Date(),
        },
      });
    } else {
      return await this.prismaService.store_settings.create({
        data: {
          ...settingsToSave,
          store_id: storeId,
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

  private async generateTokens(user: any) {
    // Extraer roles y permisos del usuario
    const roles = user.user_roles.map((ur: any) => ur.roles.name);
    const permissions = user.user_roles.flatMap((ur: any) =>
      ur.roles.role_permissions.map((rp: any) => rp.permissions.name),
    );

    const payload = {
      sub: user.id,
      email: user.email,
      roles: roles,
      permissions: permissions,
    };

    // Obtener configuraciones del entorno con valores por defecto
    const accessTokenExpiry =
      this.configService.get<string>('JWT_EXPIRES_IN') || '15m';
    const refreshTokenExpiry =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      'your-super-secret-jwt-key';

    const [access_token, refresh_token] = await Promise.all([
      // Access token con configuración del entorno
      this.jwtService.signAsync(payload, { expiresIn: accessTokenExpiry }),
      // Refresh token con secret separado y configuración del entorno
      this.jwtService.signAsync(payload, {
        expiresIn: refreshTokenExpiry,
        secret: refreshSecret,
      }),
    ]);

    // Calcular expires_in en segundos basado en la configuración
    const expiresInSeconds = this.parseExpiryToSeconds(accessTokenExpiry);

    return {
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: expiresInSeconds,
    };
  }
  private async createUserSession(
    userId: number,
    refreshToken: string,
    clientInfo?: {
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    // Obtener duración del refresh token del entorno
    const refreshTokenExpiry =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);

    // Generar fingerprint del dispositivo
    const deviceFingerprint = this.generateDeviceFingerprint(clientInfo);

    // Hashear el refresh token para almacenamiento seguro
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 12);

    await this.prismaService.refresh_tokens.create({
      data: {
        user_id: userId,
        token: hashedRefreshToken, // Guardar hash en lugar del token en claro
        expires_at: new Date(Date.now() + expiryMs),
        ip_address: clientInfo?.ipAddress || null,
        user_agent: clientInfo?.userAgent || null,
        device_fingerprint: deviceFingerprint,
        last_used: new Date(),
        revoked: false,
      },
    });
  }

  private async handleFailedLogin(userId: number) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
    });

    if (!user) return;

    const failedAttempts = user.failed_login_attempts + 1;
    const updateData: any = { failed_login_attempts: failedAttempts };

    // Bloquear cuenta después de 5 intentos fallidos por 30 minutos
    if (failedAttempts >= 5) {
      updateData.locked_until = new Date(Date.now() + 30 * 60 * 1000);
    }

    await this.prismaService.users.update({
      where: { id: userId },
      data: updateData,
    });
  }
  private async logLoginAttempt(
    userId: number | null,
    successful: boolean,
    email?: string,
  ) {
    // Obtener el email del usuario si no se proporciona
    let emailToLog = email;
    if (!emailToLog && userId) {
      const user = await this.prismaService.users.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      emailToLog = user?.email || '';
    }

    // Determinar store_id requerido por el modelo login_attempts
    let storeIdToLog: number | null = null;
    if (userId) {
      // Buscar relación store_users
      const su = await this.prismaService.store_users.findFirst({
        where: { user_id: userId },
      });
      if (su) storeIdToLog = su.store_id;

      // Si no hay store_users, intentar obtener una tienda de la organización del usuario
      if (!storeIdToLog) {
        const user = await this.prismaService.users.findUnique({
          where: { id: userId },
        });
        if (user) {
          const store = await this.prismaService.stores.findFirst({
            where: { organization_id: user.organization_id },
          });
          if (store) storeIdToLog = store.id;
        }
      }
    }

    // Fallback: si no encontramos ninguna tienda, usar null (se manejará en el schema)
    if (!storeIdToLog) {
      storeIdToLog = null; // No hay store disponible
    }

    // Solo crear el login attempt si tenemos un store_id válido
    if (storeIdToLog) {
      await this.prismaService.login_attempts.create({
        data: {
          email: emailToLog || '',
          store_id: storeIdToLog,
          success: successful,
          ip_address: '', // Se puede obtener del request en el controller
          user_agent: '', // Se puede obtener del request en el controller
          failure_reason: successful ? null : 'Invalid credentials',
        },
      });
    }
  }

  async validateUser(userId: number) {
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
      return null;
    }

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async getUserSessions(userId: number) {
    return this.prismaService.refresh_tokens.findMany({
      where: { user_id: userId },
      orderBy: { last_used: 'desc' },
    });
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
    clientInfo?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    // Si no hay información del cliente, permitir (compatibilidad con versiones anteriores)
    if (!clientInfo) {
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
    if (tokenRecord.ip_address && clientInfo.ipAddress) {
      if (tokenRecord.ip_address !== clientInfo.ipAddress) {
        console.warn('🚨 IP Address mismatch:', {
          stored: tokenRecord.ip_address,
          current: clientInfo.ipAddress,
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
    if (tokenRecord.device_fingerprint && clientInfo.userAgent) {
      const currentFingerprint = this.generateDeviceFingerprint(clientInfo);

      if (tokenRecord.device_fingerprint !== currentFingerprint) {
        const storedBrowser = this.extractBrowserFromUserAgent(
          tokenRecord.user_agent || '',
        );
        const currentBrowser = this.extractBrowserFromUserAgent(
          clientInfo.userAgent,
        );
        const storedOS = this.extractOSFromUserAgent(
          tokenRecord.user_agent || '',
        );
        const currentOS = this.extractOSFromUserAgent(clientInfo.userAgent);

        console.error('🚨 DEVICE FINGERPRINT MISMATCH:', {
          userId: tokenRecord.user_id,
          stored: {
            fingerprint: tokenRecord.device_fingerprint,
            browser: storedBrowser,
            os: storedOS,
            ip: tokenRecord.ip_address,
          },
          current: {
            fingerprint: currentFingerprint,
            browser: currentBrowser,
            os: currentOS,
            ip: clientInfo.ipAddress,
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
      clientIP: clientInfo.ipAddress,
      browser: this.extractBrowserFromUserAgent(clientInfo.userAgent || ''),
      os: this.extractOSFromUserAgent(clientInfo.userAgent || ''),
      deviceMatched:
        tokenRecord.device_fingerprint ===
        this.generateDeviceFingerprint(clientInfo),
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
  private generateDeviceFingerprint(clientInfo?: {
    ipAddress?: string;
    userAgent?: string;
  }): string {
    if (!clientInfo) {
      return 'unknown-device';
    }

    // Extraer información básica del User Agent
    const browser = this.extractBrowserFromUserAgent(
      clientInfo.userAgent || '',
    );
    const os = this.extractOSFromUserAgent(clientInfo.userAgent || '');

    // Crear fingerprint básico (sin ser invasivo)
    const fingerprint = `${browser}-${os}-${clientInfo.ipAddress?.split('.')[0] || 'unknown'}`;

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
}
