import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
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
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async runSeed() {
    try {
      console.log('🌱 Ejecutando seeds...');

      // Ejecutar el seed script compilado
      const { stdout, stderr } = await execPromise('node prisma/seed.js', {
        cwd: '/app/dist',
        env: { ...process.env },
      });

      console.log('Seed output:', stdout);
      if (stderr) console.error('Seed errors:', stderr);

      return {
        success: true,
        message: 'Seeds ejecutados exitosamente',
        output: stdout,
        errors: stderr || null,
      };
    } catch (error) {
      console.error('Error ejecutando seeds:', error);
      return {
        success: false,
        message: 'Error ejecutando seeds',
        error: error.message,
      };
    }
  }
}
