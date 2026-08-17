import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '@common/responses/response.service';
import { DianMunicipalitiesService } from '../../store/addresses/dian-municipalities.service';
import {
  DianMunicipalityQueryDto,
  DianMunicipalityResolveQueryDto,
} from '../../store/addresses/dto/dian-municipality.dto';

/**
 * Espejo de los 3 endpoints DANE del `AddressesController` (`/store/addresses/dian/*`)
 * para el contexto super-admin.
 *
 * ¿Por qué existe? El modal de edición de organización en `/super-admin/organizations`
 * reusa `app-address-form-fields` para capturar la dirección de la org. El form llama
 * a `GET /store/addresses/dian/municipalities/resolve` para traducir el output de
 * Nominatim al código Divipola. Ese endpoint está gated por `store:addresses:read`,
 * que un super-admin global NO tiene (no opera tiendas). Resultado: 403, el
 * `municipality_code` queda en null y la dirección del mapa no «guarda» el código
 * DANE, que es el bloqueante de emisión DIAN.
 *
 * El catálogo DANE es dato público de referencia (no carga ninguna fila de
 * cliente), así que es seguro exponerlo al super-admin sin filtrar por tienda.
 */
@ApiTags('Super Admin · DANE Geography')
@Controller('superadmin/addresses/dian')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DianGeographyController {
  constructor(
    private readonly dianMunicipalitiesService: DianMunicipalitiesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('municipalities')
  @ApiOperation({ summary: 'Catálogo DANE buscable (municipios)' })
  @ApiResponse({ status: 200, description: 'Municipios DANE paginados' })
  async searchMunicipalities(@Query() query: DianMunicipalityQueryDto) {
    const result = this.dianMunicipalitiesService.search(
      query.search,
      query.limit,
    );
    return this.responseService.paginated(
      result.items,
      result.total,
      1,
      query.limit ?? 20,
      'Municipios DANE obtenidos exitosamente',
    );
  }

  @Get('municipalities/resolve')
  @ApiOperation({ summary: 'Resuelve un par city/department a código DANE' })
  @ApiResponse({ status: 200, description: 'Match DANE o null si no resuelve' })
  async resolveMunicipality(@Query() query: DianMunicipalityResolveQueryDto) {
    const match = this.dianMunicipalitiesService.resolveByName(
      query.city,
      query.department,
    );
    return this.responseService.success(
      match,
      match
        ? 'Municipio DANE resuelto exitosamente'
        : 'No se pudo resolver el municipio DANE',
    );
  }

  @Get('departments')
  @ApiOperation({ summary: 'Los 33 departamentos DANE' })
  @ApiResponse({ status: 200, description: 'Departamentos DANE' })
  async listDepartments() {
    return this.responseService.success(
      this.dianMunicipalitiesService.listDepartments(),
      'Departamentos DANE obtenidos exitosamente',
    );
  }
}
