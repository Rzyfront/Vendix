import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { EmailService } from '../../email/email.service';
import { EmailBrandingService } from '../../email/services/email-branding.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../../common/audit/audit.service';
import { OnboardingService } from '../organization/onboarding/onboarding.service';
import { DefaultPanelUIService } from '../../common/services/default-panel-ui.service';
import { toTitleCase } from '@common/utils/format.util';
import { TOKEN_DEFAULTS } from './constants/token.constants';
import { S3Service } from '@common/services/s3.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { organizations } from '@prisma/client';
import { mergeStoreSettingsWithDefaults } from '../store/settings/defaults/default-store-settings';

/**
 * Result of organization lookup with smart fallback logic
 */
export interface OrganizationLookupResult {
  organization: organizations | null;
  candidates: Array<{
    id: number;
    name: string;
    slug: string;
    logo_url: string | null;
  }> | null;
  matchType:
    | 'slug_exact'
    | 'name_single'
    | 'name_filtered_by_email'
    | 'disambiguation_required'
    | 'not_found';
}

/**
 * Result of user account lookup for multi-account support
 * Handles cases where a single email has accounts in multiple organizations
 */
export interface UserAccountLookupResult {
  /** The resolved user account (null if disambiguation required or not found) */
  user: any | null;
  /** List of accounts for disambiguation (null if single account or resolved) */
  accounts: Array<{
    id: number;
    organization_id: number;
    organization_name: string;
    organization_slug: string;
    organization_logo_url: string | null;
  }> | null;
  /** Type of match result */
  matchType:
    | 'single_account' // Only one account exists → direct login
    | 'account_resolved' // Multi-account + org specified → resolved to specific account
    | 'account_disambiguation' // Multi-account + no org → show selector
    | 'no_account_in_org' // User has no account in requested organization
    | 'not_found'; // Email doesn't exist in system
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: GlobalPrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly emailBrandingService: EmailBrandingService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly onboardingService: OnboardingService,
    private readonly defaultPanelUIService: DefaultPanelUIService,
    private readonly s3Service: S3Service,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Smart Fallback: Find organization by identifier (slug or name)
   * 1. First tries exact slug match
   * 2. If no slug match, searches by name (case-insensitive)
   * 3. If multiple matches, filters by user's email domain
   * 4. Returns disambiguation candidates if still ambiguous
   */
  async findOrganizationByIdentifier(
    identifier: string,
    userEmail: string,
  ): Promise<OrganizationLookupResult> {
    const normalizedIdentifier = identifier.toLowerCase().trim();

    // 1. Try exact slug match first (most common case)
    const bySlug = await this.prismaService.organizations.findUnique({
      where: { slug: normalizedIdentifier },
    });

    if (bySlug) {
      return {
        organization: bySlug,
        candidates: null,
        matchType: 'slug_exact',
      };
    }

    // 2. Search by name (case-insensitive, partial match)
    const byName = await this.prismaService.organizations.findMany({
      where: {
        name: { contains: identifier.trim(), mode: 'insensitive' },
        state: { in: ['active', 'draft'] },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        logo_url: true,
      },
    });

    if (byName.length === 0) {
      return { organization: null, candidates: null, matchType: 'not_found' };
    }

    if (byName.length === 1) {
      const fullOrg = await this.prismaService.organizations.findUnique({
        where: { id: byName[0].id },
      });
      return {
        organization: fullOrg,
        candidates: null,
        matchType: 'name_single',
      };
    }

    // 3. Multiple results: filter by user's email domain
    const emailDomain = userEmail.split('@')[1]?.toLowerCase();

    if (emailDomain) {
      const filtered = byName.filter((org) =>
        org.email?.toLowerCase().endsWith(`@${emailDomain}`),
      );

      if (filtered.length === 1) {
        const fullOrg = await this.prismaService.organizations.findUnique({
          where: { id: filtered[0].id },
        });
        return {
          organization: fullOrg,
          candidates: null,
          matchType: 'name_filtered_by_email',
        };
      }

      // If filter reduced candidates, use filtered list for disambiguation
      if (filtered.length > 0 && filtered.length < byName.length) {
        return {
          organization: null,
          candidates: filtered.map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            logo_url: org.logo_url,
          })),
          matchType: 'disambiguation_required',
        };
      }
    }

    // 4. Requires manual disambiguation (return all candidates without email)
    return {
      organization: null,
      candidates: byName.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo_url: org.logo_url,
      })),
      matchType: 'disambiguation_required',
    };
  }

  /**
   * Find ALL user accounts by email address
   * Handles multi-account scenarios where one email exists in multiple organizations
   *
   * @param email - User's email address
   * @param organizationIdentifier - Optional org slug/name to filter by
   * @returns UserAccountLookupResult with resolved user or disambiguation candidates
   */
  async findUserAccountsByEmail(
    email: string,
    organizationIdentifier?: string,
  ): Promise<UserAccountLookupResult> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Find ALL accounts with this email (excluding suspended/archived)
    const accounts = await this.prismaService.users.findMany({
      where: {
        email: normalizedEmail,
        state: { notIn: ['suspended', 'archived'] },
      },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
        organizations: {
          include: {
            organization_settings: true,
            domain_settings: {
              where: {
                is_primary: true,
                status: 'active',
              },
            },
          },
        },
        addresses: true,
        main_store: {
          include: {
            organizations: {
              include: {
                domain_settings: {
                  where: {
                    is_primary: true,
                    status: 'active',
                  },
                },
              },
            },
            domain_settings: {
              where: {
                is_primary: true,
                status: 'active',
              },
            },
          },
        },
      },
    });

    // 2. No accounts found → not_found
    if (accounts.length === 0) {
      return { user: null, accounts: null, matchType: 'not_found' };
    }

    // 3. Single account → direct login (no disambiguation needed)
    if (accounts.length === 1) {
      return { user: accounts[0], accounts: null, matchType: 'single_account' };
    }

    // 4. Multiple accounts WITH organizationIdentifier → resolve to specific account
    if (organizationIdentifier) {
      // Use existing smart fallback to find the organization
      const lookupResult = await this.findOrganizationByIdentifier(
        organizationIdentifier,
        normalizedEmail,
      );

      // Organization not found at all
      if (lookupResult.matchType === 'not_found') {
        return { user: null, accounts: null, matchType: 'no_account_in_org' };
      }

      // Organization requires disambiguation (multiple orgs match the identifier)
      if (lookupResult.matchType === 'disambiguation_required') {
        // Filter candidates to only include orgs where the user HAS an account
        const userOrgIds = new Set(accounts.map((a) => a.organization_id));
        const validCandidates = lookupResult.candidates?.filter((c) =>
          userOrgIds.has(c.id),
        );

        // No valid candidates (user has no account in any matching org)
        if (!validCandidates || validCandidates.length === 0) {
          return { user: null, accounts: null, matchType: 'no_account_in_org' };
        }

        // Single valid candidate after filtering → resolve
        if (validCandidates.length === 1) {
          const matchedAccount = accounts.find(
            (a) => a.organization_id === validCandidates[0].id,
          );
          if (matchedAccount) {
            return {
              user: matchedAccount,
              accounts: null,
              matchType: 'account_resolved',
            };
          }
        }

        // Still multiple candidates → return for disambiguation (only orgs where user has account)
        return {
          user: null,
          accounts: accounts
            .filter((a) =>
              validCandidates.some((c) => c.id === a.organization_id),
            )
            .map((a: any) => ({
              id: a.id,
              organization_id: a.organization_id,
              organization_name: a.organizations.name,
              organization_slug: a.organizations.slug,
              organization_logo_url: a.organizations.logo_url,
            })),
          matchType: 'account_disambiguation',
        };
      }

      // Organization found → check if user has account in that org
      const targetOrgId = lookupResult.organization!.id;
      const matchedAccount = accounts.find(
        (a) => a.organization_id === targetOrgId,
      );

      if (!matchedAccount) {
        // User doesn't have an account in the requested organization
        return { user: null, accounts: null, matchType: 'no_account_in_org' };
      }

      return {
        user: matchedAccount,
        accounts: null,
        matchType: 'account_resolved',
      };
    }

    // 5. Multiple accounts WITHOUT organizationIdentifier → disambiguation required
    return {
      user: null,
      accounts: accounts.map((a: any) => ({
        id: a.id,
        organization_id: a.organization_id,
        organization_name: a.organizations.name,
        organization_slug: a.organizations.slug,
        organization_logo_url: a.organizations.logo_url,
      })),
      matchType: 'account_disambiguation',
    };
  }

  async updateProfile(userId: number, updateProfileDto: any) {
    const {
      first_name,
      last_name,
      phone,
      address,
      document_type,
      document_number,
      avatar_url,
    } = updateProfileDto;

    // 1. Actualizar datos básicos del usuario
    const updateData: any = {};
    if (first_name) updateData.first_name = first_name;
    if (last_name) updateData.last_name = last_name;
    if (phone !== undefined) updateData.phone = phone;
    if (document_type !== undefined) updateData.document_type = document_type;
    if (document_number !== undefined)
      updateData.document_number = document_number;

    // Manejar avatar_url - sanitizar para almacenar solo el key de S3, no la URL firmada
    if (avatar_url !== undefined) {
      updateData.avatar_url = this.s3Service.sanitizeForStorage(avatar_url);
    }

    const user = await this.prismaService.users.update({
      where: { id: userId },
      data: updateData,
    });

    // 2. Manejar la dirección si se proporciona
    if (address) {
      // Buscar si el usuario ya tiene una dirección (priorizar la principal)
      const existingAddress = await this.prismaService.addresses.findFirst({
        where: { user_id: userId },
        orderBy: { is_primary: 'desc' }, // Primero la principal si existe
      });

      if (existingAddress) {
        // Actualizar existente
        const addressUpdateData: any = {
          address_line1: address.address_line_1,
          address_line2: address.address_line_2,
          city: address.city,
          country_code: address.country,
          postal_code: address.postal_code,
          state_province: address.state,
          latitude: address.latitude ? parseFloat(address.latitude) : undefined,
          longitude: address.longitude
            ? parseFloat(address.longitude)
            : undefined,
        };

        await this.prismaService.addresses.update({
          where: { id: existingAddress.id },
          data: addressUpdateData,
        });
      } else {
        // Crear nueva
        await this.prismaService.addresses.create({
          data: {
            user_id: userId,
            address_line1: address.address_line_1,
            address_line2: address.address_line_2,
            city: address.city,
            country_code: address.country,
            postal_code: address.postal_code,
            state_province: address.state,
            is_primary: true,
            type: 'shipping', // Default type
            latitude: address.latitude ? parseFloat(address.latitude) : null,
            longitude: address.longitude ? parseFloat(address.longitude) : null,
            // Necesitamos el organization_id del usuario
            organization_id: user.organization_id,
          },
        });
      }
    }

    // Retornar perfil actualizado
    return this.getProfile(userId);
  }

  async getSettings(userId: number) {
    const [settings, defaults] = await Promise.all([
      this.prismaService.user_settings.findUnique({
        where: { user_id: userId },
      }),
      this.defaultPanelUIService.generatePanelUI(''),
    ]);

    if (!settings) {
      return null;
    }
    return {
      ...settings,
      default_panel_ui: defaults.panel_ui,
    };
  }

  async updateSettings(userId: number, updateSettingsDto: any) {
    const { config } = updateSettingsDto;

    // Upsert logic: create if not exists, update if exists
    // But since user_settings usually created at registration, update should suffice or upsert is safer.

    return this.prismaService.user_settings.upsert({
      where: { user_id: userId },
      update: {
        config: config ? config : undefined,
        updated_at: new Date(),
      },
      create: {
        user_id: userId,
        config: config || {},
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  async registerOwner(
    registerOwnerDto: RegisterOwnerDto,
    client_info?: { ip_address?: string; user_agent?: string },
  ) {
    const { email, password, first_name, last_name, organization_name, phone } =
      registerOwnerDto as any;

    // Preparar datos críticos antes de la transacción
    const organization_slug = this.generateSlugFromName(organization_name);

    // Verificar si slug de organización ya existe
    const existing_org = await this.prismaService.organizations.findUnique({
      where: { slug: organization_slug },
    });
    if (existing_org) {
      throw new ConflictException(
        'Una organización con este nombre ya existe.',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Convertir nombres a Title Case
    const formatted_first_name = toTitleCase(first_name || '');
    const formatted_last_name = toTitleCase(last_name || '');
    const formatted_organization_name = toTitleCase(organization_name || '');

    // Buscar si ya existe un OWNER con este email con onboarding incompleto
    // IMPORTANTE: Solo considerar owners, NO customers u otros roles
    const existingUser = await this.prismaService.users.findFirst({
      where: {
        email,
        organizations: {
          onboarding: false,
        },
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
        throw new VendixHttpException(ErrorCodes.AUTH_ROLE_001);
      }

      // Phase 4 onboarding fix — `operating_scope` derives from the chosen
      // `account_type` instead of being hardcoded:
      //   - SINGLE_STORE  → STORE  (each store isolated)
      //   - MULTI_STORE_ORG → ORGANIZATION (consolidated)
      // The DTO does not yet expose `account_type` / `operating_scope`
      // overrides, so we honor optional fields if the caller passes them
      // (forward-compatible). Final scope is locked later by the onboarding
      // wizard. Partners (`is_partner=true`) are forced to STORE — but a
      // partner organization cannot be created from this owner-registration
      // flow (the `is_partner` flag is set later by super-admin), so the
      // partner override is a defensive guard not expected to trigger here.
      const incomingAccountType = (registerOwnerDto as any).account_type;
      const accountType =
        incomingAccountType === 'SINGLE_STORE' ||
        incomingAccountType === 'MULTI_STORE_ORG'
          ? incomingAccountType
          : 'MULTI_STORE_ORG';

      const requestedScope = (registerOwnerDto as any).operating_scope as
        | 'STORE'
        | 'ORGANIZATION'
        | undefined;
      const defaultScope: 'STORE' | 'ORGANIZATION' =
        accountType === 'SINGLE_STORE' ? 'STORE' : 'ORGANIZATION';
      let resolvedScope: 'STORE' | 'ORGANIZATION' =
        requestedScope === 'STORE' || requestedScope === 'ORGANIZATION'
          ? requestedScope
          : defaultScope;

      const isPartnerCreation = (registerOwnerDto as any).is_partner === true;
      if (isPartnerCreation && resolvedScope !== 'STORE') {
        // eslint-disable-next-line no-console
        console.warn(
          `[registerOwner] Partner organization requested operating_scope=${resolvedScope}; forcing STORE.`,
        );
        resolvedScope = 'STORE';
      }

      const requestedFiscalScope = (registerOwnerDto as any).fiscal_scope as
        | 'STORE'
        | 'ORGANIZATION'
        | undefined;
      const resolvedFiscalScope: 'STORE' | 'ORGANIZATION' =
        requestedFiscalScope === 'STORE' ||
        requestedFiscalScope === 'ORGANIZATION'
          ? requestedFiscalScope
          : resolvedScope;
      if (resolvedScope === 'STORE' && resolvedFiscalScope === 'ORGANIZATION') {
        throw new BadRequestException(
          'Invalid scope combination: STORE operation cannot use consolidated fiscal scope.',
        );
      }

      const organization = await tx.organizations.create({
        data: {
          name: formatted_organization_name,
          slug: organization_slug,
          email: email,
          state: 'draft', // Organización creada en estado draft hasta completar onboarding
          account_type: accountType, // Default Multi-Store; respeta override si llega
          operating_scope: resolvedScope as any,
          fiscal_scope: resolvedFiscalScope as any,
          ...(isPartnerCreation ? { is_partner: true } : {}),
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
      }

      // Crear nuevo usuario
      user = await tx.users.create({
        data: {
          email,
          password: hashedPassword,
          first_name: formatted_first_name,
          last_name: formatted_last_name,
          phone,
          username: await this.generateUniqueUsername(email),
          email_verified: false,
          organization_id: organization.id,
        },
      });
      // Crear user_settings para el owner usando el servicio centralizado
      const ownerConfig =
        await this.defaultPanelUIService.generatePanelUI('ORG_ADMIN');
      await tx.user_settings.create({
        data: {
          user_id: user.id,
          app_type: 'ORG_ADMIN',
          config: ownerConfig,
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
        organizations: true,
      },
    });

    if (!userWithRoles) {
      throw new VendixHttpException(ErrorCodes.AUTH_CREATE_001);
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

    // Generar tokens — registro de owner es ORG_ADMIN (consistente con user_settings.app_type)
    const tokens = await this.generateTokens(userWithRoles, {
      organization_id: result.organization.id,
      store_id: null,
      app_type: 'ORG_ADMIN',
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

    // Obtener el slug de la organización para el vLink
    let organizationSlug: string | undefined;
    try {
      if (userWithRoles.organization_id) {
        const organization = await this.prismaService.organizations.findUnique({
          where: { id: userWithRoles.organization_id },
          select: { slug: true },
        });
        organizationSlug = organization?.slug;
      }
    } catch (error) {
      // Continuar sin organization slug si hay error
    }

    // Enviar email de verificación
    try {
      await this.emailService.sendVerificationEmail(
        userWithRoles.email,
        verificationToken,
        `${userWithRoles.first_name} ${userWithRoles.last_name}`,
        organizationSlug,
      );
    } catch (error) {
      // No fallar el registro si el email no se puede enviar
    }

    // Transformar user_roles a roles array simple para compatibilidad
    const { user_roles, ...userWithoutRoles } = userWithRoles;
    const roles = user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];
    const userWithRolesArray = {
      ...userWithoutRoles,
      roles, // Array simple: ["owner", "admin"]
    };

    // Remover password del response
    const { password: _, ...userWithRolesAndPassword } = userWithRolesArray;

    // Obtener user_settings del usuario creado
    const userSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userWithRoles.id },
    });

    if (!userSettings) {
      throw new Error('User settings not found after registration');
    }

    const userSettingsForResponse = {
      id: userSettings.id,
      user_id: userSettings.user_id,
      app_type: userSettings.app_type,
      config: userSettings.config || {},
    };

    return {
      user: userWithRolesAndPassword,
      user_settings: userSettingsForResponse,
      permissions: this.getPermissionsFromRoles(userWithRoles.user_roles ?? []),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      wasExistingUser: result.wasExistingUser,
    };
  }

  async registerCustomer(
    registerCustomerDto: RegisterCustomerDto,
    client_info?: { ip_address?: string; user_agent?: string },
    app: string = 'STORE_ECOMMERCE',
  ) {
    const {
      email,
      password,
      first_name,
      last_name,
      phone,
      document_type,
      document_number,
      store_id,
    } = registerCustomerDto;

    // Buscar la tienda por ID
    const store = await this.prismaService.stores.findUnique({
      where: { id: store_id },
    });
    if (!store) {
      throw new VendixHttpException(ErrorCodes.AUTH_STORE_001);
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
      throw new VendixHttpException(ErrorCodes.AUTH_ROLE_001);
    }

    // Generar contraseña si no se proporciona
    const finalPassword = password || this.generateTemporaryPassword();
    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(finalPassword, 12);

    // Convertir nombres a Title Case
    const formatted_first_name = toTitleCase(first_name || '');
    const formatted_last_name = toTitleCase(last_name || '');

    // Crear usuario (no hay store_id directo en users; se asocia en store_users)
    const user = await this.prismaService.users.create({
      data: {
        email,
        password: hashedPassword,
        first_name: formatted_first_name,
        last_name: formatted_last_name,
        phone,
        document_type,
        document_number,
        username: await this.generateUniqueUsername(email),
        email_verified: false,
        organization_id: store.organization_id,
      },
    });

    // Crear user_settings para el usuario customer usando el servicio centralizado
    const customerConfig =
      await this.defaultPanelUIService.generatePanelUI(app);
    await this.prismaService.user_settings.create({
      data: {
        user_id: user.id,
        app_type: 'STORE_ECOMMERCE',
        config: customerConfig,
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
            roles: true,
          },
        },
        user_settings: true,
        organizations: {
          include: {
            domain_settings: {
              where: {
                is_primary: true,
                status: 'active',
              },
            },
          },
        },
      },
    });

    if (!userWithRoles) {
      throw new VendixHttpException(ErrorCodes.AUTH_FIND_001);
    }

    // Generar tokens — registro de customer es STORE_ECOMMERCE
    const tokens = await this.generateTokens(userWithRoles, {
      organization_id: store.organization_id,
      store_id: null,
      app_type: 'STORE_ECOMMERCE',
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

    // Emitir evento para el sistema de notificaciones
    this.eventEmitter.emit('customer.created', {
      store_id: store.id,
      customer_id: user.id,
      first_name: formatted_first_name,
      last_name: formatted_last_name,
      email: user.email,
    });

    // Obtener el slug de la organización para el vLink
    let organizationSlug: string | undefined;
    try {
      if (userWithRoles.organization_id) {
        const organization = await this.prismaService.organizations.findUnique({
          where: { id: userWithRoles.organization_id },
          select: { slug: true },
        });
        organizationSlug = organization?.slug;
      }
    } catch (error) {
      // Continuar sin organization slug si hay error
    }

    // Enviar solo email de bienvenida de tienda para customers
    try {
      // Obtener branding de la tienda para el email de bienvenida
      let branding;
      let storeName;
      let organizationName;
      try {
        const storeWithBranding = await this.prismaService.stores.findUnique({
          where: { id: store_id },
          select: {
            name: true,
            organizations: {
              select: { name: true, slug: true },
            },
          },
        });
        if (storeWithBranding) {
          storeName = storeWithBranding.name;
          organizationName = storeWithBranding.organizations?.name;
          branding = await this.emailBrandingService.getStoreBranding(store_id);
        }
      } catch (error) {
        // Continuar sin branding si hay error
      }

      // Customers reciben email con branding de la tienda
      await this.emailService.sendWelcomeEmail(
        userWithRoles.email,
        userWithRoles.first_name,
        {
          userType: 'customer',
          branding,
          storeName,
          organizationName,
          organizationSlug,
        },
      );
    } catch (error) {
      // No fallar el registro si el email no se puede enviar
    }

    // Obtener user_settings del usuario creado
    const userSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userWithRoles.id },
    });

    if (!userSettings) {
      throw new Error('User settings not found after registration');
    }

    // Transformar user_roles a roles array simple para compatibilidad
    const { user_roles, ...userWithoutRoles } = userWithRoles;
    const roles = user_roles?.map((ur) => ur.roles?.name).filter(Boolean) || [];
    const userWithRolesArray = {
      ...userWithoutRoles,
      roles, // Array simple: ["owner", "admin"]
    };

    // Remover password del response
    const { password: _, ...userWithRolesAndPassword } = userWithRolesArray;

    const userSettingsForResponse = {
      id: userSettings.id,
      user_id: userSettings.user_id,
      app_type: userSettings.app_type,
      config: userSettings.config || {},
    };

    // Hidratar permisos planos para el frontend (gating de UI vía hasPermission()).
    // El include de registerCustomer no trae role_permissions, por eso refetcheamos.
    const userRolesWithPermissions =
      await this.prismaService.user_roles.findMany({
        where: { user_id: userWithRoles.id },
        include: {
          roles: {
            include: {
              role_permissions: {
                include: { permissions: true },
              },
            },
          },
        },
      });
    const permissions = this.getPermissionsFromRoles(userRolesWithPermissions);

    return {
      user: userWithRolesAndPassword,
      user_settings: userSettingsForResponse,
      permissions,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
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
      throw new VendixHttpException(ErrorCodes.AUTH_FIND_001);
    }

    // Verificar que el admin tenga rol de owner, admin o super_admin
    const hasPermission = adminUser.user_roles.some(
      (ur) =>
        ur.roles?.name === 'owner' ||
        ur.roles?.name === 'admin' ||
        ur.roles?.name === 'super_admin',
    );

    if (!hasPermission) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    // Obtener organización del admin
    const adminOrganization = await this.prismaService.organizations.findFirst({
      where: { id: adminUser.organization_id },
    });

    if (!adminOrganization) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
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
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
    }

    // Buscar rol en la base de datos
    const staffRole = await this.prismaService.roles.findFirst({
      where: { name: role },
    });

    if (!staffRole) {
      throw new VendixHttpException(ErrorCodes.ORG_ROLE_001);
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
        throw new VendixHttpException(ErrorCodes.ORG_STORE_001);
      }
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // Convertir nombres a Title Case
    const formatted_first_name = toTitleCase(first_name || '');
    const formatted_last_name = toTitleCase(last_name || '');

    // Crear usuario
    const user = await this.prismaService.users.create({
      data: {
        email,
        password: hashedPassword,
        first_name: formatted_first_name,
        last_name: formatted_last_name,
        username: await this.generateUniqueUsername(email),
        organization_id: adminUser.organization_id,
        email_verified: true, // Staff creado por admin, email ya verificado
        state: 'active',
      },
    });

    // Crear user_settings para el usuario staff usando el servicio centralizado (siempre STORE_ADMIN)
    const staffConfig =
      await this.defaultPanelUIService.generatePanelUI('STORE_ADMIN');
    await this.prismaService.user_settings.create({
      data: {
        user_id: user.id,
        app_type: 'STORE_ADMIN',
        config: staffConfig,
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

    // Enviar email de bienvenida con branding de la tienda/organización
    try {
      // Obtener branding para el email de bienvenida
      let branding;
      let storeName;
      let organizationName;
      let organizationSlug;
      try {
        if (store_id) {
          const storeWithBranding = await this.prismaService.stores.findUnique({
            where: { id: store_id },
            select: {
              name: true,
              organizations: {
                select: { name: true, slug: true },
              },
            },
          });
          if (storeWithBranding) {
            storeName = storeWithBranding.name;
            organizationName = storeWithBranding.organizations?.name;
            organizationSlug = storeWithBranding.organizations?.slug;
            branding =
              await this.emailBrandingService.getStoreBranding(store_id);
          }
        } else {
          // Si no hay store_id, usar branding de la organización
          const orgWithBranding =
            await this.prismaService.organizations.findUnique({
              where: { id: adminUser.organization_id },
              select: { name: true, slug: true },
            });
          if (orgWithBranding) {
            organizationName = orgWithBranding.name;
            organizationSlug = orgWithBranding.slug;
            branding = await this.emailBrandingService.getOrganizationBranding(
              adminUser.organization_id,
            );
          }
        }
      } catch (error) {
        // Continuar sin branding si hay error
      }

      // Staff recibe email con branding de la tienda/organización
      if (userWithRoles) {
        await this.emailService.sendWelcomeEmail(
          userWithRoles.email,
          userWithRoles.first_name,
          {
            userType: 'staff',
            branding,
            storeName,
            organizationName,
            organizationSlug,
          },
        );
      }
    } catch (error) {
      // No fallar el registro si el email no se puede enviar
    }

    // Remover password del response (no es necesario ya que no se incluye en la query)
    const userWithoutPassword = userWithRoles;

    return {
      message: `Usuario ${role} creado exitosamente`,
      user: userWithoutPassword,
      permissions: this.getPermissionsFromRoles(
        userWithoutPassword?.user_roles ?? [],
      ),
    };
  }

  async login(
    loginDto: LoginDto,
    client_info?: { ip_address?: string; user_agent?: string },
  ) {
    const { email, password, organization_slug, store_slug } = loginDto;

    // Validar que se proporcione al menos uno de los dos slugs (obligatorio)
    // IMPORTANT: Must validate BEFORE account lookup to avoid exposing account existence
    if (!organization_slug && !store_slug) {
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
    }

    if (organization_slug && store_slug) {
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
    }

    // 🆕 MULTI-ACCOUNT SUPPORT: Find ALL accounts for this email
    // When store_slug is provided, resolve the org slug from the store first
    // so multi-account disambiguation works correctly
    let orgIdentifierForLookup = organization_slug;
    if (store_slug && !organization_slug) {
      const storeForLookup = await this.prismaService.stores.findFirst({
        where: { slug: store_slug },
        include: { organizations: { select: { slug: true } } },
      });
      if (storeForLookup) {
        orgIdentifierForLookup = storeForLookup.organizations.slug;
      }
    }

    const accountLookup = await this.findUserAccountsByEmail(
      email,
      orgIdentifierForLookup, // Pass org identifier for resolution (from org_slug or resolved from store)
    );

    // Handle account lookup results
    if (accountLookup.matchType === 'not_found') {
      await this.logLoginAttempt(null, false, email);
      throw new VendixHttpException(ErrorCodes.AUTH_CREDENTIALS_001);
    }

    if (accountLookup.matchType === 'no_account_in_org') {
      await this.logLoginAttempt(null, false, email);
      throw new VendixHttpException(ErrorCodes.AUTH_CREDENTIALS_001);
    }

    if (accountLookup.matchType === 'account_disambiguation') {
      // HTTP 300 Multiple Choices - Frontend shows account selector
      const HTTP_MULTIPLE_CHOICES = 300;
      throw new HttpException(
        {
          statusCode: HTTP_MULTIPLE_CHOICES,
          message: 'Seleccione la organización',
          disambiguation_required: true,
          account_type: 'multi_account',
          candidates: accountLookup.accounts!.map((a) => ({
            organization_name: a.organization_name,
            organization_slug: a.organization_slug,
            organization_logo_url: a.organization_logo_url,
          })),
        },
        HTTP_MULTIPLE_CHOICES,
      );
    }

    // Account resolved (single_account or account_resolved) → continue with login
    const user = accountLookup.user!;

    // Obtener user_settings por separado para las validaciones
    let userSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: user.id },
    });

    // Transformar user_roles a roles array simple para compatibilidad con frontend
    const { user_roles, ...userWithoutRoles } = user;
    const roles =
      user_roles?.map((ur: any) => ur.roles?.name).filter(Boolean) || [];

    const userWithRolesArray = {
      ...userWithoutRoles,
      roles, // Array simple: ["owner", "admin"]
    };

    // ✅ Validar que el usuario no esté suspended o archived
    // Note: findUserAccountsByEmail already filters these, but double-check for safety
    if (user.state === 'suspended' || user.state === 'archived') {
      await this.logLoginAttempt(user.id, false);
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
    }

    // Validar consistencia entre slugs y user_settings.app_type
    const user_app_type = userSettings?.app_type;
    // Use the resolved organization slug from the user's org (important for name-based lookups)
    let effective_organization_slug = organization_slug
      ? user.organizations.slug
      : undefined;
    let effective_store_slug = store_slug;

    // 🔒 VALIDACIÓN ESTRICTA DE PERTENENCIA (Organizational Chain)
    const hasHighPrivilege = roles.some(
      (r: string) => r && ['owner', 'admin', 'super_admin'].includes(r),
    );

    // For organization_slug login, user is already validated by findUserAccountsByEmail
    // Only need to validate store_slug access
    if (store_slug) {
      const targetStore = await this.prismaService.stores.findUnique({
        where: {
          organization_id_slug: {
            organization_id: user.organization_id,
            slug: store_slug,
          },
        },
        include: { organizations: true },
      });

      if (
        !targetStore ||
        targetStore.organization_id !== user.organization_id
      ) {
        await this.logLoginAttempt(user.id, false);
        throw new VendixHttpException(ErrorCodes.AUTH_CREDENTIALS_001);
      }

      if (!hasHighPrivilege) {
        const isStoreUser = await this.prismaService.store_users.findFirst({
          where: {
            store_id: targetStore.id,
            user_id: user.id,
          },
        });

        if (!isStoreUser) {
          await this.logLoginAttempt(user.id, false);
          throw new VendixHttpException(ErrorCodes.AUTH_CREDENTIALS_001);
        }
      }
    }

    // 1. Lógica para STORE_ADMIN intentando login con Organization Slug
    if (organization_slug && user_app_type === 'STORE_ADMIN') {
      // hasHighPrivilege ya calculado arriba

      // Intentar encontrar una tienda para este usuario si no ha especificado una
      // Esto es crítico para que generateTokens reciba un store_id válido
      if (!effective_store_slug) {
        // Estrategia 1: Main Store (si existe)
        if (user.main_store_id) {
          const main_store = await this.prismaService.stores.findUnique({
            where: { id: user.main_store_id },
          });

          if (main_store) {
            // Verificar si pertenece a la misma organización
            if (main_store.organization_id === user.organization_id) {
              // Verificar acceso o si es High Privilege
              const has_access =
                await this.prismaService.store_users.findUnique({
                  where: {
                    store_id_user_id: {
                      store_id: main_store.id,
                      user_id: user.id,
                    },
                  },
                });

              if (has_access || hasHighPrivilege) {
                effective_organization_slug = undefined;
                effective_store_slug = main_store.slug;
                user.main_store = main_store;

                // AUTO-RELATION: Si es High Privilege y no tiene acceso, crear la relación
                if (hasHighPrivilege && !has_access) {
                  await this.prismaService.store_users.create({
                    data: {
                      store_id: main_store.id,
                      user_id: user.id,
                    },
                  });
                }
              }
            }
          }
        }

        // Estrategia 2: Si no hay Main Store o no se pudo seleccionar, buscar la primera tienda disponible donde YA tiene acceso
        if (!effective_store_slug) {
          const first_store_user =
            await this.prismaService.store_users.findFirst({
              where: {
                user_id: user.id,
                store: {
                  organization_id: user.organization_id, // Asegurar que sea de la misma org
                },
              },
              include: { store: true },
            });

          if (first_store_user && first_store_user.store) {
            effective_organization_slug = undefined;
            effective_store_slug = first_store_user.store.slug;
          }
        }

        // Estrategia 3: High Privilege Fallback - Buscar CUALQUIER tienda de la org
        if (!effective_store_slug && hasHighPrivilege) {
          const first_org_store = await this.prismaService.stores.findFirst({
            where: { organization_id: user.organization_id },
          });

          if (first_org_store) {
            effective_organization_slug = undefined;
            effective_store_slug = first_org_store.slug;

            // AUTO-RELATION: Crear relación explícita
            await this.prismaService.store_users.create({
              data: {
                store_id: first_org_store.id,
                user_id: user.id,
              },
            });
          }
        }
      }
    }

    // 2. Lógica para ORG_ADMIN intentando login con Store Slug
    if (store_slug && userSettings && userSettings.app_type === 'ORG_ADMIN') {
      // Actualizar app_type en base de datos
      userSettings = await this.prismaService.user_settings.update({
        where: { id: userSettings.id },
        data: { app_type: 'STORE_ADMIN' },
      });

      // El flujo continúa normalmente con effective_store_slug
    }

    // Validar que el usuario pertenezca a la organización o tienda especificada
    let target_organization_id: number | null = null;
    let target_store_id: number | null = null;
    let login_context: string = '';
    let active_store: {
      id: number;
      name: string;
      slug: string;
      logo_url: string | null;
      store_type: string;
      onboarding: boolean;
      organizations: any;
      store_settings?: any;
      domain_settings?: any;
    } | null = null;
    let active_store_settings: any = null;

    if (effective_organization_slug) {
      // Verificar que el usuario pertenezca a la organización especificada
      if (user.organization_id) {
        const userOrganization =
          await this.prismaService.organizations.findUnique({
            where: { id: user.organization_id },
          });

        if (
          !userOrganization ||
          userOrganization.slug !== effective_organization_slug
        ) {
          await this.logLoginAttempt(user.id, false);
          throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
        }

        target_organization_id = userOrganization.id;
        login_context = `organization:${effective_organization_slug}`;
      } else {
        await this.logLoginAttempt(user.id, false);
        throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
      }
    } else if (effective_store_slug) {
      // Verificar que el usuario tenga acceso a la tienda especificada
      let storeUser = await this.prismaService.store_users.findFirst({
        where: {
          user_id: user.id,
          store: {
            slug: effective_store_slug,
            organization_id: user.organization_id, // Asegurar consistencia organizacional
          },
        },
        include: {
          store: {
            include: {
              store_settings: true,
              organizations: {
                include: {
                  organization_settings: true,
                  domain_settings: {
                    where: {
                      is_primary: true,
                      status: 'active',
                    },
                  },
                },
              },
              domain_settings: {
                where: {
                  is_primary: true,
                  status: 'active',
                },
              },
            },
          },
        },
      });

      // AUTO-RELATION: Si es High Privilege y la tienda existe en su organización, permitir y crear relación
      if (!storeUser && hasHighPrivilege) {
        const targetStore = await this.prismaService.stores.findUnique({
          where: {
            organization_id_slug: {
              organization_id: user.organization_id,
              slug: effective_store_slug,
            },
          },
          include: {
            store_settings: true,
            organizations: {
              include: {
                organization_settings: true,
                domain_settings: {
                  where: {
                    is_primary: true,
                    status: 'active',
                  },
                },
              },
            },
            domain_settings: {
              where: {
                is_primary: true,
                status: 'active',
              },
            },
          },
        });

        if (targetStore) {
          // Crear la relación automáticamente para futuros accesos
          await this.prismaService.store_users.create({
            data: {
              store_id: targetStore.id,
              user_id: user.id,
            },
          });

          // Simular el objeto storeUser para continuar con el flujo normal
          storeUser = { store: targetStore } as any;
        }
      }

      if (!storeUser) {
        await this.logLoginAttempt(user.id, false);
        throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
      }

      target_organization_id = storeUser.store.organizations.id;
      target_store_id = storeUser.store.id;
      active_store = storeUser.store; // Guardar la tienda activa
      active_store_settings = mergeStoreSettingsWithDefaults(
        storeUser.store.store_settings?.settings,
      );
      login_context = `store:${effective_store_slug}`;
    }

    // Verificar si la cuenta está bloqueada
    if (user.locked_until && new Date() < user.locked_until) {
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
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
      throw new VendixHttpException(ErrorCodes.AUTH_CREDENTIALS_001);
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

    // Generar tokens (con usuario sin permisos para payload optimizado)
    // app_type sale de user_settings (fuente única de verdad léxica) si existe;
    // si no, generateTokens hace fallback por scope (store_id ⇒ STORE_ADMIN).
    const tokens = await this.generateTokens(user, {
      organization_id: target_organization_id!,
      store_id: target_store_id,
      app_type: (userSettings?.app_type as any) || undefined,
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
        organization_id: target_organization_id ?? undefined,
        store_id: target_store_id ?? undefined,
      },
      client_info?.ip_address || '127.0.0.1',
      client_info?.user_agent || 'Login-Device',
    );

    // Actualizar último login
    await this.prismaService.users.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    // Remover password del response
    // Nota: domain_settings ya viene incluido en la relación de store.organizations
    // Limpiar store para evitar duplicación de store_settings (ya se envía a nivel raíz)
    const storeToUse = active_store || user.main_store;
    const signedLogoUrl = await this.s3Service.signUrl(storeToUse?.logo_url);
    const cleanStore = storeToUse
      ? {
          id: storeToUse.id,
          name: storeToUse.name,
          slug: storeToUse.slug,
          logo_url: signedLogoUrl,
          store_type: storeToUse.store_type,
          onboarding: storeToUse.onboarding,
          organizations: storeToUse.organizations,
          domain_settings: storeToUse.domain_settings,
          // store_settings OMITIDO - ya se envía a nivel raíz como store_settings
        }
      : null;

    const { password: _, ...userWithRolesAndPassword } = {
      ...userWithRolesArray,
      store: cleanStore,
    };

    if (!userSettings) {
      throw new VendixHttpException(ErrorCodes.AUTH_FIND_001);
    }

    const userSettingsForResponse = {
      id: userSettings.id,
      user_id: userSettings.user_id,
      app_type: userSettings.app_type,
      config: userSettings.config || {},
    };

    // Obtener defaults para detectar módulos nuevos en el frontend
    const defaults = await this.defaultPanelUIService.generatePanelUI('');

    // Hidratar permisos planos para el frontend (gating de UI vía hasPermission()).
    // findUserAccountsByEmail no incluye role_permissions.permissions, por eso refetcheamos.
    const userRolesWithPermissions =
      await this.prismaService.user_roles.findMany({
        where: { user_id: user.id },
        include: {
          roles: {
            include: {
              role_permissions: {
                include: { permissions: true },
              },
            },
          },
        },
      });
    const permissions = this.getPermissionsFromRoles(userRolesWithPermissions);

    return {
      user: userWithRolesAndPassword, // Usar usuario con roles array simple y store activo
      user_settings: userSettingsForResponse,
      store_settings: active_store_settings,
      default_panel_ui: defaults.panel_ui,
      permissions,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
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
    permissions: string[];
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
        this.configService.get<string>('JWT_SECRET');

      if (!refreshSecret) {
        throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
      }

      // Verificar el refresh token JWT (firma y expiración)
      const payload = this.jwtService.verify(refresh_token, {
        secret: refreshSecret,
      });

      // Buscar tokens activos del usuario (por user_id del payload JWT)
      // No podemos buscar por hash directamente porque bcrypt genera hashes diferentes cada vez
      const activeTokens = await this.prismaService.refresh_tokens.findMany({
        where: {
          user_id: payload.sub,
          revoked: false,
          expires_at: { gt: new Date() },
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

      // Comparar con bcrypt.compare() - forma correcta de validar hashes bcrypt
      let tokenRecord: (typeof activeTokens)[number] | null = null;
      for (const record of activeTokens) {
        const isValid = await bcrypt.compare(refresh_token, record.token);
        if (isValid) {
          tokenRecord = record;
          break;
        }
      }

      if (!tokenRecord) {
        throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
      }

      // 🔒 VALIDACIONES DE SEGURIDAD ADICIONALES
      await this.validateRefreshTokenSecurity(tokenRecord, client_info);

      // 🔒 VERIFICAR QUE EL TOKEN TIENE USUARIO ASOCIADO
      const user = tokenRecord.users;
      if (!user) {
        throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
      }

      // 🔒 VALIDACIÓN DE ORGANIZACIÓN: Asegurar que el token scope corresponde al usuario
      if (Number(payload.organization_id) !== user.organization_id) {
        throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
      }

      // Generar nuevos tokens — preservar app_type del refresh token original
      // para no perder el dominio durante el refresh.
      const tokens = await this.generateTokens(user, {
        organization_id: payload.organization_id,
        store_id: payload.store_id,
        app_type: payload.app_type,
      });

      // El password no está incluido en esta consulta por seguridad
      const userWithoutPassword = user;

      // Actualizar el refresh token en la base de datos
      const refreshTokenExpiry =
        this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
        TOKEN_DEFAULTS.REFRESH_TOKEN_EXPIRY;
      const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);

      // Hashear el nuevo refresh token antes de guardarlo
      const hashedNewToken = await bcrypt.hash(
        tokens.refresh_token,
        TOKEN_DEFAULTS.BCRYPT_ROUNDS,
      );

      await this.prismaService.refresh_tokens.update({
        where: { id: tokenRecord.id },
        data: {
          token: hashedNewToken,
          expires_at: new Date(Date.now() + expiryMs),
          // Actualizar información de seguridad
          ip_address: client_info?.ip_address || tokenRecord.ip_address,
          user_agent: client_info?.user_agent || tokenRecord.user_agent,
          last_used: new Date(),
        },
      });

      return {
        user: userWithoutPassword,
        permissions: this.getPermissionsFromRoles(
          (userWithoutPassword as any).user_roles ?? [],
        ),
        ...tokens,
      };
    } catch (error) {
      throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
    }
  }

  async getProfile(userId: number) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        addresses: true,
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
      throw new VendixHttpException(ErrorCodes.AUTH_FIND_001);
    }

    // Remover password del response
    const { password, ...userWithoutPassword } = user;

    // Firmar el avatar_url si existe (convertir key de S3 a URL firmada)
    const signedAvatarUrl = await this.s3Service.signUrl(user.avatar_url);

    return {
      ...userWithoutPassword,
      avatar_url: signedAvatarUrl || null,
    };
  }

  async logout(
    user_id: number,
    refresh_token?: string,
    all_sessions: boolean = true, // Por defecto cerrar todas las sesiones para mayor seguridad
  ) {
    const now = new Date();

    if (all_sessions) {
      // Cerrar TODAS las sesiones activas del usuario (máxima seguridad)
      const result = await this.prismaService.refresh_tokens.updateMany({
        where: {
          user_id: user_id,
          revoked: false,
        },
        data: {
          revoked: true,
          revoked_at: now,
        },
      });

      // También eliminar cualquier refresh token expirado (limpieza completa)
      await this.prismaService.refresh_tokens.deleteMany({
        where: {
          user_id: user_id,
          expires_at: { lt: now },
        },
      });

      // Registrar auditoría completa
      await this.auditService.logAuth(user_id, AuditAction.LOGOUT, {
        action: 'logout_all_sessions',
        sessions_revoked: result.count,
        security_level: 'maximum',
        all_tokens_invalidated: true,
      });

      return {
        message: `Todas las sesiones han sido cerradas por seguridad.`,
        data: {
          sessions_revoked: result.count,
          security_level: 'maximum',
          all_sessions_closed: true,
        },
      };
    }

    if (refresh_token) {
      // Hashear el refresh token para comparación
      const hashedRefreshToken = await bcrypt.hash(refresh_token, 12);

      // Revocar el token específico Y todos los demás del usuario (seguridad mejorada)
      try {
        // Primero revocar el token específico
        const specificResult =
          await this.prismaService.refresh_tokens.updateMany({
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

        // Luego revocar todos los demás tokens del usuario (previene session hijacking)
        const otherTokensResult =
          await this.prismaService.refresh_tokens.updateMany({
            where: {
              user_id: user_id,
              id: { not: undefined }, // No podemos excluir por hash porque es diferente cada vez
              revoked: false,
            },
            data: {
              revoked: true,
              revoked_at: now,
            },
          });

        const totalRevoked = specificResult.count + otherTokensResult.count;

        // Registrar auditoría de seguridad mejorada
        await this.auditService.logAuth(user_id, AuditAction.LOGOUT, {
          action: 'logout_with_security_cleanup',
          specific_token_revoked: specificResult.count,
          other_tokens_revoked: otherTokensResult.count,
          total_sessions_revoked: totalRevoked,
          security_level: 'enhanced',
        });

        return {
          message:
            'Sesión cerrada exitosamente. Todas las sesiones han sido invalidadas por seguridad.',
          data: {
            sessions_revoked: totalRevoked,
            security_level: 'enhanced',
            all_sessions_invalidated: true,
          },
        };
      } catch (error) {
        throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
      }
    }

    // Si no hay token específico ni all_sessions, cerrar todo por defecto (fallback seguro)
    const fallbackResult = await this.prismaService.refresh_tokens.updateMany({
      where: {
        user_id: user_id,
        revoked: false,
      },
      data: {
        revoked: true,
        revoked_at: now,
      },
    });

    await this.auditService.logAuth(user_id, AuditAction.LOGOUT, {
      action: 'logout_fallback_security',
      sessions_revoked: fallbackResult.count,
      reason: 'no_token_provided',
    });

    return {
      message: 'Por seguridad, todas las sesiones han sido cerradas.',
      data: { sessions_revoked: fallbackResult.count },
    };
  }

  // ===== FUNCIONES DE VERIFICACIÓN DE EMAIL =====

  async sendEmailVerification(userId: number): Promise<void> {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.AUTH_FIND_001);
    }

    if (user.email_verified) {
      throw new VendixHttpException(ErrorCodes.AUTH_VERIFY_001);
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

    // Obtener el slug de la organización para el vLink
    let organizationSlug: string | undefined;
    try {
      if (user.organization_id) {
        const organization = await this.prismaService.organizations.findUnique({
          where: { id: user.organization_id },
          select: { slug: true },
        });
        organizationSlug = organization?.slug;
      }
    } catch (error) {
      // Continuar sin organization slug si hay error
    }

    // Enviar email de verificación
    await this.emailService.sendVerificationEmail(
      user.email,
      token,
      user.first_name,
      organizationSlug,
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
      throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
    }

    if (verificationToken.verified) {
      throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
    }

    if (new Date() > verificationToken.expires_at) {
      throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
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

  async resendEmailVerification(email: string): Promise<{
    message: string;
    alreadyVerified?: boolean;
  }> {
    const user = await this.prismaService.users.findFirst({
      where: { email },
    });

    if (!user) {
      // Por seguridad, siempre devolvemos el mismo mensaje para evitar enumeración
      return {
        message: 'Si el email existe, recibirás instrucciones',
        alreadyVerified: false,
      };
    }

    // Si el email ya está verificado, retornamos un mensaje informativo sin error
    if (user.email_verified) {
      return {
        message:
          'Este email ya ha sido verificado anteriormente. Puedes continuar con el inicio de sesión.',
        alreadyVerified: true,
      };
    }

    // Enviar email de verificación
    await this.sendEmailVerification(user.id);

    return {
      message: 'Email de verificación enviado',
      alreadyVerified: false,
    };
  }

  async checkEmailVerificationStatus(
    email: string,
  ): Promise<{ exists: boolean; verified: boolean }> {
    const user = await this.prismaService.users.findFirst({
      where: { email },
      select: { email_verified: true },
    });

    return {
      exists: !!user,
      verified: user?.email_verified || false,
    };
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
      throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
    }

    if (resetToken.used) {
      throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
    }

    if (new Date() > resetToken.expires_at) {
      throw new VendixHttpException(ErrorCodes.AUTH_TOKEN_001);
    }

    // Verificar que el usuario aún existe y está activo
    if (!resetToken.users || resetToken.users.state !== 'active') {
      throw new VendixHttpException(ErrorCodes.AUTH_FIND_001);
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
      throw new VendixHttpException(ErrorCodes.AUTH_FIND_001);
    }

    // Verificar contraseña actual
    const isCurrentPasswordValid = await bcrypt.compare(
      current_password,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      throw new VendixHttpException(ErrorCodes.AUTH_PASSWORD_001);
    }

    // Validar fortaleza de la nueva contraseña
    if (!this.validatePasswordStrength(new_password)) {
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
    }

    // Verificar que la nueva contraseña no sea igual a la actual
    const isSamePassword = await bcrypt.compare(new_password, user.password);
    if (isSamePassword) {
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
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

  // ===== FUNCIONES AUXILIARES =====

  private generateSlugFromName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, '-') // Reemplazar espacios con guiones
      .replace(/-+/g, '-') // Remover guiones múltiples
      .trim();
  }

  private generateRandomToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  private async generateTokens(
    user: any,
    scope: {
      organization_id: number;
      store_id?: number | null;
      app_type?:
        | 'VENDIX_LANDING'
        | 'VENDIX_ADMIN'
        | 'ORG_LANDING'
        | 'ORG_ADMIN'
        | 'STORE_LANDING'
        | 'STORE_ADMIN'
        | 'STORE_ECOMMERCE';
    },
  ): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  }> {
    // ✅ Resolver app_type para el claim del JWT.
    // Prioridad: scope.app_type explícito → user.user_settings.app_type → default por scope.
    // Default: si hay store_id → STORE_ADMIN; si no → ORG_ADMIN.
    // Esto es CRÍTICO para DomainScopeGuard. Sin este claim, el guard rechaza la request.
    const resolvedAppType =
      scope.app_type ||
      user?.user_settings?.app_type ||
      (scope.store_id ? 'STORE_ADMIN' : 'ORG_ADMIN');

    const payload = {
      sub: user.id,
      organization_id: scope.organization_id,
      store_id: scope.store_id,
      app_type: resolvedAppType,
    };

    const accessTokenExpiry =
      this.configService.get<string>('JWT_EXPIRES_IN') ||
      TOKEN_DEFAULTS.ACCESS_TOKEN_EXPIRY;

    const refreshTokenExpiry =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
      TOKEN_DEFAULTS.REFRESH_TOKEN_EXPIRY;

    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      this.configService.get<string>('JWT_SECRET');

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessTokenExpiry as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshSecret as string,
      expiresIn: refreshTokenExpiry as any,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.parseExpiryToMilliseconds(accessTokenExpiry),
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
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
      TOKEN_DEFAULTS.REFRESH_TOKEN_EXPIRY;
    const expiryMs = this.parseExpiryToMilliseconds(refreshTokenExpiry);

    // Generar fingerprint del dispositivo
    const device_fingerprint = this.generateDeviceFingerprint(client_info);

    // Hashear el refresh token para almacenamiento seguro
    const hashedRefreshToken = await bcrypt.hash(
      refresh_token,
      TOKEN_DEFAULTS.BCRYPT_ROUNDS,
    );

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

  async getCurrentUser(user_id: number) {
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
            organizations: {
              include: {
                organization_settings: true,
                domain_settings: {
                  where: {
                    is_primary: true,
                status: 'active',
              },
            },
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    const { password, user_roles, ...userWithoutPassword } = user as any;
    const roles =
      user_roles?.map((ur: any) => ur.roles?.name).filter(Boolean) || [];

    return {
      ...userWithoutPassword,
      roles,
    };
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

  private generateTemporaryPassword(): string {
    // Generar una contraseña temporal segura
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
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

  // ===== MÉTODOS DE CAMBIO DE ENTORNO =====

  async switchEnvironment(
    userId: number,
    targetEnvironment: 'STORE_ADMIN' | 'ORG_ADMIN',
    storeSlug?: string,
  ) {
    // Validar que el usuario exista
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

    // Validar el entorno objetivo
    if (targetEnvironment === 'STORE_ADMIN' && !storeSlug) {
      throw new BadRequestException(
        'Se requiere el slug de la tienda para cambiar a STORE_ADMIN',
      );
    }

    // Verificar que el usuario tenga los roles necesarios
    const userRoles = user.user_roles
      .map((ur) => ur.roles?.name)
      .filter(Boolean);

    let store_id: number | null = null;
    let store: any = null; // Declarar en scope más amplio para usarlo más adelante
    if (targetEnvironment === 'STORE_ADMIN') {
      const hasStoreRole =
        userRoles.includes('store_admin') ||
        userRoles.includes('owner') ||
        userRoles.includes('manager');

      if (!hasStoreRole) {
        throw new UnauthorizedException(
          'No tienes permisos para acceder al entorno de tienda',
        );
      }

      // Verificar que la tienda exista y el usuario tenga acceso
      store = await this.prismaService.stores.findFirst({
        where: {
          slug: storeSlug,
          organization_id: user.organization_id,
        },
        include: {
          organizations: {
            include: {
              domain_settings: {
                where: {
                  is_primary: true,
                  status: 'active',
                },
              },
            },
          },
          domain_settings: {
            where: {
              is_primary: true,
              status: 'active',
            },
          },
        },
      });

      if (!store) {
        throw new NotFoundException('Tienda no encontrada');
      }

      // Verificar que el usuario pertenezca a la organización de la tienda
      const hasAccess =
        userRoles.includes('super_admin') || userRoles.includes('owner');

      if (!hasAccess) {
        throw new UnauthorizedException('No tienes acceso a esta tienda');
      }

      store_id = store.id;
    }

    if (targetEnvironment === 'ORG_ADMIN') {
      const hasOrgRole =
        userRoles.includes('org_admin') ||
        userRoles.includes('owner') ||
        userRoles.includes('super_admin');

      if (!hasOrgRole) {
        throw new UnauthorizedException(
          'No tienes permisos para acceder al entorno de organización',
        );
      }
    }

    // Generar tokens con el MISMO formato que el JwtStrategy espera
    // Usar el MISMO formato que generateTokens para consistencia total
    let organization_id: number;
    let activeStore: any = null;
    let organizations: any = null;

    if (store_id) {
      // Switch a STORE_ADMIN: usar la org del store seleccionado
      // Ya tenemos el store con todas las relaciones del query anterior
      activeStore = store; // Ya incluye domain_settings
      organizations = store.organizations; // Ya incluye domain_settings
      organization_id = store.organization_id;
    } else {
      // Switch a ORG_ADMIN: volver a la org original del usuario
      // Necesitamos obtener la organización con sus domain_settings
      const org = await this.prismaService.organizations.findUnique({
        where: { id: user.organization_id },
        include: {
          domain_settings: {
            where: {
              is_primary: true,
              status: 'active',
            },
          },
        },
      });
      organizations = org;
      organization_id = user.organization_id;
    }

    const payload = {
      sub: user.id,
      organization_id: organization_id, // ✅ snake_case como en generateTokens
      store_id: store_id, // ✅ snake_case como en generateTokens
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn:
        this.configService.get('JWT_EXPIRES_IN') ||
        TOKEN_DEFAULTS.ACCESS_TOKEN_EXPIRY,
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn:
        this.configService.get('JWT_REFRESH_EXPIRES_IN') ||
        TOKEN_DEFAULTS.REFRESH_TOKEN_EXPIRY,
    });

    const tokens = {
      accessToken,
      refreshToken,
    };

    // Obtener permisos y roles actualizados
    const permissions = this.getPermissionsFromRoles(user.user_roles);
    const roles = userRoles;

    // Registrar el cambio de entorno en auditoría
    await this.auditService.log({
      userId: userId,
      action: AuditAction.UPDATE,
      resource: AuditResource.USERS,
      metadata: {
        action: 'environment_switch',
        targetEnvironment,
        storeSlug: storeSlug || null,
      },
    });

    // Construir el usuario completo con la misma estructura que el login
    const userWithEnvironment = {
      ...user,
      store: activeStore, // Store con domain_settings incluido
      organizations: organizations, // Organization con domain_settings incluido
    };

    return {
      user: userWithEnvironment,
      tokens,
      permissions,
      roles,
      updatedEnvironment: targetEnvironment,
    };
  }

  async loginCustomer(
    loginCustomerDto: any,
    client_info?: { ip_address?: string; user_agent?: string },
  ) {
    const { email, password, store_id } = loginCustomerDto;

    // Buscar la tienda
    const store = await this.prismaService.stores.findUnique({
      where: { id: store_id },
    });

    if (!store) {
      throw new BadRequestException('Tienda no encontrada');
    }

    // Buscar usuario
    const user = await this.prismaService.users.findFirst({
      where: {
        email,
        organization_id: store.organization_id,
      },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
        user_settings: true,
        organizations: {
          include: {
            domain_settings: {
              where: {
                is_primary: true,
                status: 'active',
              },
            },
          },
        },
        store_users: {
          where: { store_id: store.id },
        },
      },
    });

    if (!user) {
      await this.logLoginAttempt(null, false, email);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Validar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await this.logLoginAttempt(user.id, false);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Validar que el usuario no esté suspendido o archivado
    if (user.state === 'suspended' || user.state === 'archived') {
      await this.logLoginAttempt(user.id, false);
      throw new UnauthorizedException('Cuenta suspendida o archivada');
    }

    // Validar que sea un cliente
    const roles = user.user_roles?.map((ur) => ur.roles?.name) || [];
    if (!roles.includes('customer')) {
      throw new UnauthorizedException('Acceso restringido a clientes');
    }

    // Validar que esté asociado a esta tienda
    if (user.store_users.length === 0) {
      throw new UnauthorizedException('No tienes acceso a esta tienda');
    }

    // Generar tokens — customer login siempre es STORE_ECOMMERCE
    const tokens = await this.generateTokens(user, {
      organization_id: store.organization_id,
      store_id: store.id,
      app_type: 'STORE_ECOMMERCE',
    });

    await this.createUserSession(user.id, tokens.refresh_token, {
      ip_address: client_info?.ip_address || '127.0.0.1',
      user_agent: client_info?.user_agent || 'Customer-Device',
    });

    await this.logLoginAttempt(user.id, true);

    // Hidratar permisos planos para el frontend (gating de UI vía hasPermission()).
    // El include de loginCustomer no trae role_permissions, por eso refetcheamos.
    const userRolesWithPermissions =
      await this.prismaService.user_roles.findMany({
        where: { user_id: user.id },
        include: {
          roles: {
            include: {
              role_permissions: {
                include: { permissions: true },
              },
            },
          },
        },
      });
    const permissions = this.getPermissionsFromRoles(userRolesWithPermissions);

    return {
      user: user,
      user_settings: user.user_settings,
      permissions,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: 'Bearer',
      expires_in: tokens.expires_in,
      roles,
      updatedEnvironment: 'STORE_ECOMMERCE',
    };
  }
}
