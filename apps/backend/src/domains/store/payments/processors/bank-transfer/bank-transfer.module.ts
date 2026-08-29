import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../../prisma/prisma.module';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { BankTransferProcessor } from './bank-transfer.processor';

/**
 * QUI-728 — módulo de transferencia bancaria.
 *
 * La migración a `useFactory`/`inject` (patrón `wompi.module.ts:9-25`) es lo que
 * le da al processor su `StorePrismaService`. Antes el `providers: [BankTransferProcessor]`
 * plano no resolvía la dependencia del constructor, así que Nest inyectaba `undefined`
 * y el processor no podía consultar la tabla `bank_accounts`.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: BankTransferProcessor,
      useFactory: (prisma: StorePrismaService) => new BankTransferProcessor(prisma),
      inject: [StorePrismaService],
    },
  ],
  exports: [BankTransferProcessor],
})
export class BankTransferModule {}
