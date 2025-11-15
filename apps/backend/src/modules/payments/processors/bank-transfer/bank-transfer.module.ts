import { Module } from '@nestjs/common';
import { BankTransferProcessor } from './bank-transfer.processor';

@Module({
  providers: [BankTransferProcessor],
  exports: [BankTransferProcessor],
})
export class BankTransferModule {}
