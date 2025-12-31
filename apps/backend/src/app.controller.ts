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
import { GlobalPrismaService } from './prisma/services/global-prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: GlobalPrismaService,
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
  async runClean(@Body() body: { secretKey: string }) {
    if (body.secretKey !== 'vendix-dangerous-clean') {
      throw new ForbiddenException('Invalid secret key');
    }

    try {


      const { stdout, stderr } = await execPromise('node prisma/clean.js', {
        cwd: '/app/dist',
        env: { ...process.env },
      });

      if (stderr) { }

      return {
        success: true,
        message: 'Base de datos limpiada exitosamente',
        output: stdout,
        errors: stderr || null,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error limpiando base de datos',
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


      // 1. Ejecutar Clean

      const cleanResult = await execPromise('node prisma/clean.js', {
        cwd: '/app/dist',
        env: { ...process.env },
      });
      if (cleanResult.stderr) { }

      // 2. Ejecutar Seed

      const seedResult = await execPromise('node prisma/seed.js', {
        cwd: '/app/dist',
        env: { ...process.env },
      });
      if (seedResult.stderr) { }

      return {
        success: true,
        message: 'Reset completado exitosamente',
        clean_output: cleanResult.stdout,
        seed_output: seedResult.stdout,
        errors: {
          clean: cleanResult.stderr || null,
          seed: seedResult.stderr || null,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error durante el reset de base de datos',
        error: error.message,
      };
    }
  }
}
