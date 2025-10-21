// apps/backend/src/modules/greeting/greeting.controller.ts
import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GreetingService } from './greeting.service';
import { CreateGreetingDto } from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ResponseService } from '../../common/responses/response.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('greeting')
@ApiTags('Greeting')
export class GreetingController {
    constructor(
        private readonly greetingService: GreetingService,
        private readonly responseService: ResponseService,
    ) { }

    @Post('funny-insult')
    @Public() // ← ¡Esto hace el endpoint público!
    @ApiOperation({
        summary: 'Crear un insulto gracioso personalizado',
        description: 'Crea un insulto gracioso y juguetón para la persona especificada'
    })
    @ApiResponse({
        status: 201,
        description: 'Insulto gracioso creado exitosamente',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string', example: '¡Operación completada!' },
                data: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', example: '¡Hola Juan! ¿Sigues buscando ese cerebro que perdiste?' },
                        victim_name: { type: 'string', example: 'Juan' },
                        insult_level: { type: 'string', example: 'suave' },
                        disclaimer: { type: 'string', example: 'Esto es solo una broma...' }
                    }
                }
            }
        }
    })
    async createFunnyInsult(
        @Body() createGreetingDto: CreateGreetingDto
    ) {
        try {
            const result = await this.greetingService.createFunnyGreeting(createGreetingDto);
            return this.responseService.success(result.data, result.message);
        } catch (error) {
            return this.responseService.error(
                error.message || 'Error al crear insulto gracioso',
                error.response?.message || error.message,
                error.status || 400,
            );
        }
    }

    @Get('insult-levels')
    @Public() // ← ¡Esto hace el endpoint público!
    @ApiOperation({
        summary: 'Obtener niveles de insultos disponibles',
        description: 'Muestra los diferentes niveles de intensidad y temas disponibles'
    })
    async getInsultLevels() {
        try {
            const levels = await this.greetingService.getInsultLevels();
            return this.responseService.success(levels, 'Niveles de insultos obtenidos exitosamente');
        } catch (error) {
            return this.responseService.error(
                error.message || 'Error al obtener niveles de insultos',
                error.response?.message || error.message,
                error.status || 400,
            );
        }
    }
}
