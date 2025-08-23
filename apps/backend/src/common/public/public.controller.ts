import { 
  Controller, 
  Get, 
  Param, 
  NotFoundException, 
  BadRequestException,
  Logger,
  HttpCode,
  HttpStatus,
  Query,
  Headers
} from '@nestjs/common';
import { DomainResolutionService, DomainResolutionResponse } from '../services/domain-resolution.service';

/**
 * Controlador público para endpoints que no requieren autenticación
 * Incluye la resolución de dominios para arquitectura multi-tenant
 */
@Controller('api/public')
export class PublicController {
  private readonly logger = new Logger(PublicController.name);

  constructor(private readonly domainResolutionService: DomainResolutionService) {}

  /**
   * Resuelve la configuración de un dominio específico
   * 
   * @param hostname - El hostname a resolver (ej: "store.mordoc.com")
   * @returns Configuración completa del tenant incluyendo branding, tema, features, etc.
   * 
   * @example
   * GET /api/public/domains/resolve/store.mordoc.com
   * GET /api/public/domains/resolve/localhost:4200?subdomain=luda
   */
  @Get('domains/resolve/:hostname')
  @HttpCode(HttpStatus.OK)
  async resolveDomain(
    @Param('hostname') hostname: string,
    @Query('subdomain') subdomain?: string,
    @Headers('x-forwarded-host') forwardedHost?: string,
    @Headers('host') hostHeader?: string
  ): Promise<DomainResolutionResponse> {
    try {
      // Validar entrada
      if (!hostname || hostname.trim() === '') {
        throw new BadRequestException('Hostname parameter is required');
      }

      // Normalizar hostname
      let resolvedHostname = hostname.toLowerCase().trim();
      
      // Si es localhost y tenemos subdomain, construir el hostname completo
      if (resolvedHostname.includes('localhost') && subdomain) {
        resolvedHostname = `${subdomain}.${resolvedHostname}`;
      }

      // Usar forwarded host si está disponible (útil para proxies/load balancers)
      if (forwardedHost) {
        resolvedHostname = forwardedHost.toLowerCase().trim();
      }

      this.logger.log(`Resolving domain configuration for: ${resolvedHostname}`);

      // Resolver la configuración del dominio
      const domainConfig = await this.domainResolutionService.resolveDomain(resolvedHostname);

      if (!domainConfig) {
        this.logger.warn(`Domain configuration not found for: ${resolvedHostname}`);
        throw new NotFoundException(`Domain configuration not found for hostname: ${resolvedHostname}`);
      }

      // Log successful resolution
      this.logger.log(`Successfully resolved domain: ${resolvedHostname} -> Organization: ${domainConfig.organizationId}`);

      return domainConfig;

    } catch (error) {
      this.logger.error(`Error resolving domain ${hostname}:`, error.message);
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      // Para errores internos, log detallado pero respuesta genérica
      this.logger.error(`Internal error resolving domain ${hostname}:`, error);
      throw new NotFoundException(`Unable to resolve domain configuration for: ${hostname}`);
    }
  }

  /**
   * Verifica si un dominio está disponible y configurado
   * 
   * @param hostname - El hostname a verificar
   * @returns Estado del dominio (disponible, configurado, etc.)
   */
  @Get('domains/check/:hostname')
  @HttpCode(HttpStatus.OK)
  async checkDomain(@Param('hostname') hostname: string): Promise<{
    hostname: string;
    available: boolean;
    configured: boolean;
    active: boolean;
    organizationId?: number;
    storeId?: number;
  }> {
    try {
      if (!hostname || hostname.trim() === '') {
        throw new BadRequestException('Hostname parameter is required');
      }

      const normalizedHostname = hostname.toLowerCase().trim();
      this.logger.log(`Checking domain availability: ${normalizedHostname}`);

      const domainConfig = await this.domainResolutionService.resolveDomain(normalizedHostname);

      return {
        hostname: normalizedHostname,
        available: !domainConfig, // Si no existe configuración, está disponible
        configured: !!domainConfig,
        active: !!domainConfig, // Simplificado: si existe, está activo
        organizationId: domainConfig?.organizationId,
        storeId: domainConfig?.storeId
      };

    } catch (error) {
      this.logger.error(`Error checking domain ${hostname}:`, error.message);
      
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Para errores de verificación, devolver como no disponible
      return {
        hostname: hostname.toLowerCase().trim(),
        available: false,
        configured: false,
        active: false
      };
    }
  }

  /**
   * Endpoint de health check público
   * Útil para verificar que el servicio está funcionando
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  async healthCheck(): Promise<{
    status: string;
    timestamp: string;
    service: string;
  }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'vendix-backend-public'
    };
  }

  /**
   * Obtiene información básica sobre los tipos de dominio soportados
   * Útil para documentación y debugging
   */
  @Get('domains/types')
  @HttpCode(HttpStatus.OK)
  async getDomainTypes(): Promise<{
    domainTypes: Array<{
      type: string;
      description: string;
      examples: string[];
    }>;
    purposes: Array<{
      purpose: string;
      description: string;
    }>;
  }> {
    return {
      domainTypes: [
        {
          type: 'vendix_core',
          description: 'Dominios principales de Vendix',
          examples: ['vendix.com', 'admin.vendix.com', 'api.vendix.com']
        },
        {
          type: 'organization_root',
          description: 'Dominio raíz de la organización',
          examples: ['mordoc.com', 'acme.com']
        },
        {
          type: 'organization_subdomain',
          description: 'Subdominio de la organización',
          examples: ['app.mordoc.com', 'portal.acme.com']
        },
        {
          type: 'store_subdomain',
          description: 'Subdominio de tienda',
          examples: ['luda.mordoc.com', 'store.acme.com']
        },
        {
          type: 'store_custom',
          description: 'Dominio personalizado de tienda',
          examples: ['luda.com', 'mystoresite.com']
        }
      ],
      purposes: [
        {
          purpose: 'landing',
          description: 'Página de inicio o marketing'
        },
        {
          purpose: 'admin',
          description: 'Panel de administración'
        },
        {
          purpose: 'ecommerce',
          description: 'Tienda online'
        },
        {
          purpose: 'api',
          description: 'Endpoints de API'
        }
      ]
    };
  }
}
