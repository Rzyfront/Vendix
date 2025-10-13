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

@Controller('bypass-email')
@UseGuards(DevelopmentOnlyGuard)
@Public()
export class BypassEmailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: { user_id: number }) {
    const { user_id } = body;

    if (!user_id) {
      throw new ForbiddenException('User ID is required');
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

      return {
        success: true,
        message: 'Email verificado exitosamente (bypass desarrollo)',
        user: updatedUser,
      };
    } catch (error) {
      if (error.code === 'P2025') {
        throw new ForbiddenException('Usuario no encontrado');
      }
      throw error;
    }
  }
}