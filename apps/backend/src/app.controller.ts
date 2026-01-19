import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Body,
  ForbiddenException,
} from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './domains/auth/decorators/public.decorator';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
  ) { }

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async runSeed(@Body() body: { secretKey: string }) {
    if (body.secretKey !== 'vendix-initial-seeds') {
      throw new ForbiddenException('Invalid secret key');
    }

    try {


      // Ejecutar el seed script compilado
      const { stdout, stderr } = await execPromise('node prisma/seed.js', {
        cwd: '/app/dist',
        env: { ...process.env },
      });

      if (stderr) { }

      return {
        success: true,
        message: 'Seeds ejecutados exitosamente',
        output: stdout,
        errors: stderr || null,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error ejecutando seeds',
        error: error.message,
      };
    }
  }

  @Public()
  @Post('clean')
  @HttpCode(HttpStatus.OK)
  async runClean(@Body() body: { secretKey: string; module?: string }) {
    if (body.secretKey !== 'vendix-dangerous-clean') {
      throw new ForbiddenException('Invalid secret key');
    }

    try {
      // Ejecutar script con argumento de módulo opcional
      const moduleArg = body.module ? ` ${body.module}` : '';
      const { stdout, stderr } = await execPromise(`node prisma/seeds/shared/database-scripts/clean.js${moduleArg}`, {
        cwd: '/app/dist',
        env: { ...process.env },
      });

      return {
        success: true,
        message: body.module
          ? `Módulo '${body.module}' limpiado exitosamente`
          : 'Base de datos limpiada exitosamente',
        output: stdout,
        errors: stderr || null,
      };
    } catch (error) {
      return {
        success: false,
        message: body.module
          ? `Error limpiando módulo '${body.module}'`
          : 'Error limpiando base de datos',
        error: error.message,
      };
    }
  }

  @Public()
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async runReset(@Body() body: { secretKey: string }) {
    if (body.secretKey !== 'vendix-dangerous-reset') {
      throw new ForbiddenException('Invalid secret key');
    }

    try {
      const { stdout, stderr } = await execPromise('node prisma/seeds/shared/database-scripts/reset.js', {
        cwd: '/app/dist',
        env: { ...process.env },
      });

      return {
        success: true,
        message: 'Reset completado exitosamente',
        output: stdout,
        errors: stderr || null,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error durante el reset de base de datos',
        error: error.message,
      };
    }
  }

  @Public()
  @Post('db-stats')
  @HttpCode(HttpStatus.OK)
  async getDbStats(@Body() body: { secretKey: string }) {
    if (body.secretKey !== 'vendix-stats-query') {
      throw new ForbiddenException('Invalid secret key');
    }

    try {
      const { stdout, stderr } = await execPromise('node prisma/seeds/shared/database-scripts/stats.js', {
        cwd: '/app/dist',
        env: { ...process.env },
      });

      return {
        success: true,
        stats: stdout,
        errors: stderr || null,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error obteniendo estadísticas',
        error: error.message,
      };
    }
  }
}
