import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletBalanceService } from './services/wallet-balance.service';
import { WalletPaymentProcessor } from './services/wallet-payment.processor';

@Module({
  imports: [PrismaModule, ResponseModule, CashRegistersModule],
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
