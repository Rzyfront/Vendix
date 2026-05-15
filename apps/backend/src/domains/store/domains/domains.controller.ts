import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { DomainRegistrationGuard } from '../../../common/services/rate-limit/domain-registration.guard';
import { StoreDomainsService } from './domains.service';
import {
  CreateStoreDomainDto,
  CreateDomainRootAssignmentDto,
  CreateDomainRootDto,
  UpdateStoreDomainDto,
  StoreDomainQueryDto,
} from './dto';

@Controller('store/domains')
export class StoreDomainsController {
  constructor(
    private readonly domains_service: StoreDomainsService,
    private readonly response_service: ResponseService,
  ) {}

  @Post()
  @UseGuards(DomainRegistrationGuard)
  @Permissions('store:domains:create')
  async create(@Body() create_domain_dto: CreateStoreDomainDto) {
    try {
      const domain = await this.domains_service.create(create_domain_dto);
      return this.response_service.created(
        domain,
        'Dominio creado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al crear el dominio',
        error.message,
      );
    }
  }

  @Get()
  @Permissions('store:domains:read')
  async findAll(@Query() query: StoreDomainQueryDto) {
    try {
      const result = await this.domains_service.findAll(query);
      return this.response_service.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Dominios obtenidos exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al obtener los dominios',
        error.message,
      );
    }
  }

  @Post('roots')
  @UseGuards(DomainRegistrationGuard)
  @Permissions('store:domains:create')
  async createRoot(@Body() create_root_dto: CreateDomainRootDto) {
    try {
      const root = await this.domains_service.createRoot(create_root_dto);
      return this.response_service.created(
        root,
        'Dominio base creado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al crear el dominio base',
        error.message,
      );
    }
  }

  @Get('roots')
  @Permissions('store:domains:read')
  async findRoots() {
    try {
      const roots = await this.domains_service.findRoots();
      return this.response_service.success(
        roots,
        'Dominios base obtenidos exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al obtener dominios base',
        error.message,
      );
    }
  }

  @Get('roots/:rootId')
  @Permissions('store:domains:read')
  async findRoot(@Param('rootId', ParseIntPipe) rootId: number) {
    try {
      const root = await this.domains_service.findRoot(rootId);
      return this.response_service.success(
        root,
        'Dominio base obtenido exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al obtener el dominio base',
        error.message,
      );
    }
  }

  @Get('roots/:rootId/dns-instructions')
  @Permissions('store:domains:read')
  async getRootDnsInstructions(@Param('rootId', ParseIntPipe) rootId: number) {
    try {
      const instructions =
        await this.domains_service.getRootDnsInstructions(rootId);
      return this.response_service.success(
        instructions,
        'Instrucciones DNS obtenidas exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al obtener instrucciones DNS',
        error.message,
      );
    }
  }

  @Post('roots/:rootId/verify')
  @Permissions('store:domains:update')
  async verifyRoot(@Param('rootId', ParseIntPipe) rootId: number) {
    try {
      const result = await this.domains_service.verifyRoot(rootId);
      return this.response_service.success(
        result,
        'Verificación DNS ejecutada exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al verificar el dominio base',
        error.message,
      );
    }
  }

  @Post('roots/:rootId/provision-next')
  @Permissions('store:domains:update')
  async provisionRootNext(@Param('rootId', ParseIntPipe) rootId: number) {
    try {
      const root = await this.domains_service.provisionRootNext(rootId);
      return this.response_service.success(
        root,
        'Provisioning del dominio base actualizado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al provisionar el dominio base',
        error.message,
      );
    }
  }

  @Post('roots/:rootId/assignments')
  @UseGuards(DomainRegistrationGuard)
  @Permissions('store:domains:create')
  async createRootAssignment(
    @Param('rootId', ParseIntPipe) rootId: number,
    @Body() create_assignment_dto: CreateDomainRootAssignmentDto,
  ) {
    try {
      const domain = await this.domains_service.createRootAssignment(
        rootId,
        create_assignment_dto,
      );
      return this.response_service.created(
        domain,
        'Asignación creada exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al crear la asignación',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('store:domains:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const domain = await this.domains_service.findOne(id);
      return this.response_service.success(
        domain,
        'Dominio obtenido exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al obtener el dominio',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:domains:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() update_domain_dto: UpdateStoreDomainDto,
  ) {
    try {
      const domain = await this.domains_service.update(id, update_domain_dto);
      return this.response_service.updated(
        domain,
        'Dominio actualizado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al actualizar el dominio',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:domains:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.domains_service.remove(id);
      return this.response_service.deleted('Dominio eliminado exitosamente');
    } catch (error) {
      return this.response_service.error(
        'Error al eliminar el dominio',
        error.message,
      );
    }
  }

  @Post(':id/set-primary')
  @Permissions('store:domains:update')
  async setAsPrimary(@Param('id', ParseIntPipe) id: number) {
    try {
      const domain = await this.domains_service.setAsPrimary(id);
      return this.response_service.updated(
        domain,
        'Dominio establecido como principal exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al establecer el dominio como principal',
        error.message,
      );
    }
  }

  @Get(':id/dns-instructions')
  @Permissions('store:domains:read')
  async getDnsInstructions(@Param('id', ParseIntPipe) id: number) {
    try {
      const instructions = await this.domains_service.getDnsInstructions(id);
      return this.response_service.success(
        instructions,
        'Instrucciones DNS obtenidas exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al obtener instrucciones DNS',
        error.message,
      );
    }
  }

  @Post(':id/verify')
  @Permissions('store:domains:update')
  async verifyDomain(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.domains_service.verifyDomain(id);
      return this.response_service.success(
        result,
        'Verificación DNS ejecutada exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al verificar el dominio',
        error.message,
      );
    }
  }

  @Post(':id/certificate/request')
  @Permissions('store:domains:update')
  async startCertificateProvisioning(@Param('id', ParseIntPipe) id: number) {
    try {
      const domain =
        await this.domains_service.startCertificateProvisioning(id);
      return this.response_service.success(
        domain,
        'Solicitud de certificado iniciada exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al solicitar el certificado',
        error.message,
      );
    }
  }

  @Get(':id/certificate/status')
  @Permissions('store:domains:read')
  async refreshCertificateStatus(@Param('id', ParseIntPipe) id: number) {
    try {
      const domain = await this.domains_service.refreshCertificateStatus(id);
      return this.response_service.success(
        domain,
        'Estado del certificado actualizado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al consultar el certificado',
        error.message,
      );
    }
  }

  @Post(':id/cloudfront/alias')
  @Permissions('store:domains:update')
  async attachCloudFrontAlias(@Param('id', ParseIntPipe) id: number) {
    try {
      const domain = await this.domains_service.attachCloudFrontAlias(id);
      return this.response_service.success(
        domain,
        'Conexión del dominio configurada exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al configurar la conexión del dominio',
        error.message,
      );
    }
  }

  @Get(':id/cloudfront/status')
  @Permissions('store:domains:read')
  async refreshCloudFrontStatus(@Param('id', ParseIntPipe) id: number) {
    try {
      const domain = await this.domains_service.refreshCloudFrontStatus(id);
      return this.response_service.success(
        domain,
        'Estado de conexión actualizado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al consultar la conexión del dominio',
        error.message,
      );
    }
  }

  @Post(':id/provision-next')
  @Permissions('store:domains:update')
  async provisionNext(@Param('id', ParseIntPipe) id: number) {
    try {
      const domain = await this.domains_service.provisionNext(id);
      return this.response_service.success(
        domain,
        'Provisioning del dominio actualizado exitosamente',
      );
    } catch (error) {
      return this.response_service.error(
        'Error al provisionar el dominio',
        error.message,
      );
    }
  }
}
