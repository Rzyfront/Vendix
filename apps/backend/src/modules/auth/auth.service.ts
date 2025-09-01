import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { LoginDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { users } from '@prisma/client';
import slugify from 'slugify';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Registra a un nuevo dueño de organización.
   * Crea la organización y el usuario dueño en una sola transacción.
   */
  async registerOwner(registerOwnerDto: RegisterOwnerDto) {
    const { organizationName, email, password, first_name, last_name } =
      registerOwnerDto;

    const organizationSlug = slugify(organizationName, {
      lower: true,
      strict: true,
    });

    // 1. Verificar si ya existe una organización con el mismo slug
    const existingOrganization = await this.organizationsService.findBySlug(
      organizationSlug,
    );
    if (existingOrganization) {
      throw new ConflictException(
        'Una organización con este nombre ya existe.',
      );
    }

    // 2. Iniciar transacción
    return this.prisma.$transaction(async (tx) => {
      // 2a. Crear la organización
      const organization = await tx.organizations.create({
        data: {
          name: organizationName,
          slug: organizationSlug,
          email: email, // Asignamos el email del owner como contacto inicial
        },
      });

      // 2b. Verificar si el email ya está en uso DENTRO de esta nueva organización (no debería pasar, pero es una salvaguarda)
      const existingUserInOrg = await tx.users.findFirst({
        where: {
          email,
          organization_id: organization.id,
        },
      });

      if (existingUserInOrg) {
        throw new ConflictException(
          'Este usuario ya existe en esta organización.',
        );
      }

      // 2c. Hashear contraseña y crear usuario
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await tx.users.create({
        data: {
          email,
          password: hashedPassword,
          first_name,
          last_name,
          username: email, // O generar un username único si se prefiere
          organization_id: organization.id,
          onboarding_completed: false, // Inicia el onboarding
        },
      });

      // TODO: Asignar rol de 'owner' al usuario

      // 2d. Generar tokens
      const tokens = await this.generateTokens(newUser);
      return {
        ...tokens,
        user: this.getSanitizedUser(newUser),
      };
    });
  }

  /**
   * Inicia sesión de un usuario en el contexto de una organización.
   */
  async login(loginDto: LoginDto) {
    const { email, password, organizationSlug } = loginDto;

    // 1. Encontrar la organización por slug
    const organization = await this.organizationsService.findBySlug(
      organizationSlug,
    );
    if (!organization) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 2. Encontrar al usuario por email DENTRO de esa organización
    const user = await this.prisma.users.findFirst({
      where: {
        email,
        organization_id: organization.id,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 3. Comparar contraseñas
    const isPasswordMatching = await bcrypt.compare(password, user.password);
    if (!isPasswordMatching) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 4. Generar y devolver tokens
    const tokens = await this.generateTokens(user);
    return {
      ...tokens,
      user: this.getSanitizedUser(user),
    };
  }

  /**
   * Genera un nuevo par de access_token y refresh_token.
   */
  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refresh_token } = refreshTokenDto;

    try {
      const payload = this.jwtService.verify(refresh_token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const user = await this.prisma.users.findUnique({
        where: { id: payload.sub },
      });
      if (!user) {
        throw new UnauthorizedException('Usuario no encontrado');
      }

      // Validar que el refresh token existe en la BD y no está revocado
      const tokenInDb = await this.prisma.refresh_tokens.findFirst({
        where: { token: refresh_token, user_id: user.id, revoked: false },
      });

      if (!tokenInDb) {
        throw new UnauthorizedException('Token de refresco inválido o revocado');
      }

      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }
  }

  /**
   * Cierra la sesión de un usuario invalidando su refresh token.
   */
  async logout(userId: number, refreshToken: string) {
    try {
      await this.prisma.refresh_tokens.updateMany({
        where: {
          user_id: userId,
          token: refreshToken,
        },
        data: {
          revoked: true,
        },
      });
      return { message: 'Sesión cerrada exitosamente' };
    } catch (error) {
      throw new InternalServerErrorException(
        'No se pudo cerrar la sesión.',
      );
    }
  }

  /**
   * Obtiene el perfil de un usuario.
   */
  async getProfile(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return this.getSanitizedUser(user);
  }

  // --- Métodos de ayuda ---

  /**
   * Genera el access token y el refresh token para un usuario.
   */
  private async generateTokens(user: users) {
    const payload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organization_id,
      // TODO: Añadir roles y permisos al payload si es necesario
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_SECRET,
        expiresIn: '15m',
      }),
      this.jwtService.signAsync({ sub: user.id }, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: '7d',
      }),
    ]);

    // Almacenar el nuevo refresh token en la base de datos
    await this.storeRefreshToken(refreshToken, user.id);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  /**
   * Almacena el refresh token en la base de datos.
   */
  private async storeRefreshToken(token: string, userId: number) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Asume una expiración de 7 días

    // Opcional: invalidar otros refresh tokens del mismo usuario para mayor seguridad
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked: false },
      data: { revoked: true },
    });

    await this.prisma.refresh_tokens.create({
      data: {
        user_id: userId,
        token: token,
        expires_at: expiresAt,
      },
    });
  }

  /**
   * Devuelve un objeto de usuario sin la contraseña.
   */
  private getSanitizedUser(user: users) {
    const { password, ...sanitizedUser } = user;
    return sanitizedUser;
  }

  // --- Funciones pendientes de refactorizar ---
  // Estas funciones necesitan ser adaptadas al nuevo flujo multi-inquilino

  async register(registerDto: any): Promise<void> {
    // Deprecated
  }

  async registerCustomer(
    registerCustomerDto: RegisterCustomerDto,
  ): Promise<void> {
    // TODO: Implementar
  }

  async verifyEmail(token: string): Promise<void> {
    // TODO: Implementar
  }

  async resendEmailVerification(email: string): Promise<void> {
    // TODO: Implementar
  }

  async forgotPassword(email: string): Promise<void> {
    // TODO: Implementar
  }

  async resetPassword(token: string, newPass: string): Promise<void> {
    // TODO: Implementar
  }

  async changePassword(
    userId: number,
    oldPass: string,
    newPass: string,
  ): Promise<void> {
    // TODO: Implementar
  }

  async getUserSessions(userId: number): Promise<void> {
    // TODO: Implementar
  }

  // ... (métodos de onboarding)
  async startOnboarding(userId: number): Promise<void> {
    // TODO: Implementar
  }
  async createOrganizationDuringOnboarding(
    userId: number,
    data: any,
  ): Promise<void> {
    // TODO: Implementar
  }
  async setupOrganization(
    userId: number,
    orgId: number,
    data: any,
  ): Promise<void> {
    // TODO: Implementar
  }
  async createStoreDuringOnboarding(
    userId: number,
    orgId: number,
    data: any,
  ): Promise<void> {
    // TODO: Implementar
  }
  async setupStore(userId: number, storeId: number, data: any): Promise<void> {
    // TODO: Implementar
  }
  async completeOnboarding(userId: number): Promise<void> {
    // TODO: Implementar
  }
}
