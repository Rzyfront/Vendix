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
} from '@nestjs/common';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { StoreDomainsService } from './domains.service';
import {
    CreateStoreDomainDto,
    UpdateStoreDomainDto,
    StoreDomainQueryDto,
} from './dto';

@Controller('store/domains')
export class StoreDomainsController {
    constructor(
        private readonly domains_service: StoreDomainsService,
        private readonly response_service: ResponseService,
    ) { }

    @Post()
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
}
