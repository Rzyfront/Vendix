import { Module } from '@nestjs/common';
import { BankTransferProcessor } from './bank-transfer.processor';

/**
 * QUI-728 — módulo de transferencia bancaria.
 *
 * QUI-727 (F.1) / ADR-3 — el processor YA NO inyecta `StorePrismaService`:
 * dejó de resolver la cuenta bancaria por id (ese fallback saltaba el scope de
 * tienda). La cuenta la resuelve y valida el gateway y se la pasa en
 * `paymentData.bankAccount`; el processor ya no consulta `bank_accounts`, por lo
 * que se registra como provider simple.
 */
@Module({
  providers: [BankTransferProcessor],
  exports: [BankTransferProcessor],
})
export class BankTransferModule {}
