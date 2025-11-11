import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { DevelopmentOnlyGuard } from '../../common/guards/development-only.guard';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('bypass-email')
@UseGuards(DevelopmentOnlyGuard)
@Public()
export class BypassEmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: { user_id: number }) {
    const { user_id } = body;

    if (!user_id) {
      return this.responseService.error(
        'User ID is required',
        'Falta el ID del usuario',
      );
    }

    try {
      // Actualizar el usuario para marcar el email como verificado
      const updatedUser = await this.prisma.users.update({
        where: { id: user_id },
        data: {
          email_verified: true,
          state: 'active', // Activar el usuario también
        },
        select: {
          id: true,
          email: true,
          email_verified: true,
          state: true,
          first_name: true,
          last_name: true,
        },
      });

      return this.responseService.success(
        updatedUser,
        'Email verificado exitosamente (bypass desarrollo)',
      );
    } catch (error) {
      if (error.code === 'P2025') {
        return this.responseService.error(
          'Usuario no encontrado',
          'El usuario especificado no existe',
        );
      }
      return this.responseService.error(
        'Error al verificar email',
        error.message,
      );
    }
  }
}
