import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    // Conecta a la base de datos cuando el módulo se inicializa
    await this.$connect();
    console.log('Prisma connected to database');
  }

  async enableShutdownHooks(app: INestApplication) {
    // Asegura que la conexión se cierre limpiamente al apagar la app
    process.on('beforeExit', async () => {
      await this.$disconnect();
      await app.close();
    });
  }
}
