import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';
import { OrderHistoryModule } from '../orders/order-history/order-history.module';
import { ServiceDepositsService } from './service-deposits.service';

/**
 * Consumable-deposit ledger of stations (`service_deposits`). The sessions,
 * reservations and payment-request modules import it and call the `*InTx`
 * methods inside their own transactions.
 */
@Module({
  imports: [PrismaModule, WalletModule, CashRegistersModule, OrderHistoryModule],
  providers: [ServiceDepositsService],
  exports: [ServiceDepositsService],
})
export class ServiceDepositsModule {}
