import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreatePaymentAgreementDto } from '../dto/create-payment-agreement.dto';

@Injectable()
export class PaymentAgreementService {
  constructor(private readonly prisma: StorePrismaService) {}

  // ─── CREATE AGREEMENT ──────────────────────────────────────
  async create(ar_id: number, dto: CreatePaymentAgreementDto, user_id: number) {
    const ar = await this.prisma.accounts_receivable.findFirst({
      where: { id: ar_id },
    });

    if (!ar) {
      throw new NotFoundException(`Cuenta por cobrar #${ar_id} no encontrada`);
    }

    if (!['open', 'partial', 'overdue'].includes(ar.status)) {
      throw new BadRequestException(
        `No se puede crear un acuerdo para una cuenta con estado "${ar.status}"`,
      );
    }

    const balance = Number(ar.balance);
    const interest_rate = dto.interest_rate || 0;
    const total_with_interest = balance * (1 + interest_rate / 100);
    const installment_amount =
      Math.round((total_with_interest / dto.num_installments) * 100) / 100;

    // Generate agreement number
    const year = new Date().getFullYear();
    const last_agreement = await this.prisma.payment_agreements.findFirst({
      where: {
        agreement_number: { startsWith: `AGR-${year}-` },
      },
      orderBy: { created_at: 'desc' },
    });

    let sequence = 1;
    if (last_agreement?.agreement_number) {
      const parts = last_agreement.agreement_number.split('-');
      sequence = parseInt(parts[2] || '0', 10) + 1;
    }
    const agreement_number = `AGR-${year}-${String(sequence).padStart(4, '0')}`;

    // Generate installment dates
    const start_date = new Date(dto.start_date);
    const installments: {
      installment_number: number;
      amount: number;
      due_date: Date;
    }[] = [];

    for (let i = 0; i < dto.num_installments; i++) {
      const due_date = new Date(start_date);
      due_date.setMonth(due_date.getMonth() + i);

      // Adjust last installment for rounding
      const amount =
        i === dto.num_installments - 1
          ? Math.round(
              (total_with_interest -
                installment_amount * (dto.num_installments - 1)) *
                100,
            ) / 100
          : installment_amount;

      installments.push({
        installment_number: i + 1,
        amount,
        due_date,
      });
    }

    // Create in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const agreement = await tx.payment_agreements.create({
        data: {
          accounts_receivable_id: ar_id,
          store_id: ar.store_id,
          agreement_number,
          total_amount: total_with_interest,
          num_installments: dto.num_installments,
          interest_rate: interest_rate,
          state: 'active',
          start_date,
          notes: dto.notes || null,
          created_by: user_id,
          agreement_installments: {
            create: installments.map((inst) => ({
              installment_number: inst.installment_number,
              amount: inst.amount,
              due_date: inst.due_date,
              state: 'pending',
              paid_amount: 0,
            })),
          },
        },
        include: {
          agreement_installments: {
            orderBy: { installment_number: 'asc' },
          },
        },
      });

      return agreement;
    });

    return result;
  }

  // ─── FIND BY AR ────────────────────────────────────────────
  async findByAr(ar_id: number) {
    return this.prisma.payment_agreements.findMany({
      where: { accounts_receivable_id: ar_id },
      include: {
        agreement_installments: {
          orderBy: { installment_number: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ─── REGISTER INSTALLMENT PAYMENT ──────────────────────────
  async registerInstallmentPayment(installment_id: number, amount: number) {
    const installment = await this.prisma.agreement_installments.findFirst({
      where: { id: installment_id },
      include: {
        payment_agreement: true,
      },
    });

    if (!installment) {
      throw new NotFoundException(`Cuota #${installment_id} no encontrada`);
    }

    if (installment.state === 'paid') {
      throw new BadRequestException('Esta cuota ya fue pagada');
    }

    const remaining =
      Number(installment.amount) - Number(installment.paid_amount);

    if (amount > remaining) {
      throw new BadRequestException(
        `El monto ($${amount}) excede el saldo de la cuota ($${remaining})`,
      );
    }

    const new_paid = Number(installment.paid_amount) + amount;
    const is_fully_paid = new_paid >= Number(installment.amount);

    const result = await this.prisma.$transaction(async (tx) => {
      // Update installment
      const updated_installment = await tx.agreement_installments.update({
        where: { id: installment_id },
        data: {
          paid_amount: new_paid,
          state: is_fully_paid ? 'paid' : 'partial',
          paid_at: is_fully_paid ? new Date() : null,
        },
      });

      // Check if all installments are paid
      const pending_installments = await tx.agreement_installments.count({
        where: {
          payment_agreement_id: installment.payment_agreement_id,
          state: { not: 'paid' },
          id: { not: installment_id },
        },
      });

      // If this was the last installment and it's now paid, complete the agreement
      if (is_fully_paid && pending_installments === 0) {
        await tx.payment_agreements.update({
          where: { id: installment.payment_agreement_id },
          data: { state: 'completed' },
        });
      }

      return updated_installment;
    });

    return result;
  }
}
