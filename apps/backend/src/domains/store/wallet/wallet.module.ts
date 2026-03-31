import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletBalanceService } from './services/wallet-balance.service';
import { WalletPaymentProcessor } from './services/wallet-payment.processor';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    WalletBalanceService,
    {
      provide: WalletPaymentProcessor,
      useFactory: (balanceService: WalletBalanceService) =>
        new WalletPaymentProcessor(balanceService),
      inject: [WalletBalanceService],
    },
  ],
  exports: [WalletService, WalletBalanceService, WalletPaymentProcessor],
})
export class WalletModule {}
