import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { WithholdingCalculatorService } from './withholding-calculator.service';
import {
  CreateWithholdingConceptDto,
  UpdateWithholdingConceptDto,
} from './dto';
import { WithholdingCertificateData } from './interfaces/withholding.interface';

@Injectable()
export class WithholdingTaxService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly calculator: WithholdingCalculatorService,
    private readonly event_emitter: EventEmitter2,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  // ===== Withholding Concepts CRUD =====

  async findAllConcepts() {
    return this.prisma.withholding_concepts.findMany({
      orderBy: { code: 'asc' },
    });
  }

  async findOneConcept(id: number) {
    const concept = await this.prisma.withholding_concepts.findFirst({
      where: { id },
    });

    if (!concept) {
      throw new VendixHttpException(ErrorCodes.WHT_CONCEPT_NOT_FOUND);
    }

    return concept;
  }

  async createConcept(dto: CreateWithholdingConceptDto) {
    const context = RequestContextService.getContext()!;
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id!,
        store_id: context.store_id ?? null,
      });

    // Check for duplicate code
    const existing = await this.prisma.withholding_concepts.findFirst({
      where: {
        accounting_entity_id: accounting_entity.id,
        code: dto.code,
      },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.WHT_CONCEPT_DUPLICATE);
    }

    return this.prisma.withholding_concepts.create({
      data: {
        organization_id: context.organization_id,
        accounting_entity_id: accounting_entity.id,
        code: dto.code,
        name: dto.name,
        rate: new Prisma.Decimal(dto.rate),
        min_uvt_threshold: new Prisma.Decimal(dto.min_uvt_threshold || 0),
        applies_to: dto.applies_to as any,
        supplier_type_filter: (dto.supplier_type_filter || 'any') as any,
        is_active: true,
      },
    });
  }

  async updateConcept(id: number, dto: UpdateWithholdingConceptDto) {
    await this.findOneConcept(id);

    const data: any = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.rate !== undefined) data.rate = new Prisma.Decimal(dto.rate);
    if (dto.min_uvt_threshold !== undefined)
      data.min_uvt_threshold = new Prisma.Decimal(dto.min_uvt_threshold);
    if (dto.applies_to !== undefined) data.applies_to = dto.applies_to;
    if (dto.supplier_type_filter !== undefined)
      data.supplier_type_filter = dto.supplier_type_filter;

    return this.prisma.withholding_concepts.update({
      where: { id },
      data,
    });
  }

  async deactivateConcept(id: number) {
    await this.findOneConcept(id);

    return this.prisma.withholding_concepts.update({
      where: { id },
      data: { is_active: false },
    });
  }

  // ===== UVT Values CRUD =====

  async findAllUvt() {
    const context = RequestContextService.getContext()!;

    return this.prisma.uvt_values.findMany({
      where: { organization_id: context.organization_id },
      orderBy: { year: 'desc' },
    });
  }

  async createUvt(data: { year: number; value_cop: number }) {
    const context = RequestContextService.getContext()!;
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id!,
        store_id: context.store_id ?? null,
      });

    // Upsert: if the year already exists, update; otherwise create
    const existing = await this.prisma.uvt_values.findFirst({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: accounting_entity.id,
        year: data.year,
      },
    });

    if (existing) {
      return this.prisma.uvt_values.update({
        where: { id: existing.id },
        data: { value_cop: new Prisma.Decimal(data.value_cop) },
      });
    }

    return this.prisma.uvt_values.create({
      data: {
        organization_id: context.organization_id,
        accounting_entity_id: accounting_entity.id,
        year: data.year,
        value_cop: new Prisma.Decimal(data.value_cop),
      },
    });
  }

  // ===== Withholding Calculation =====

  async calculateWithholding(
    amount: number,
    concept_code: string,
    supplier_type?: string,
  ) {
    const context = RequestContextService.getContext()!;

    return this.calculator.calculateWithholding({
      amount,
      concept_code,
      supplier_type,
      organization_id: context.organization_id!,
    });
  }

  // ===== Apply Withholding to Invoice =====

  async applyWithholding(
    invoice_id: number,
    concept_code: string,
    supplier_type?: string,
  ) {
    const context = RequestContextService.getContext()!;
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id!,
        store_id: context.store_id ?? null,
      });

    // Get the invoice to determine the base amount
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: invoice_id },
      include: {
        supplier: { select: { id: true, name: true, tax_id: true } },
      },
    });

    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.WHT_CALCULATION_ERROR,
        'Invoice not found',
      );
    }

    const base_amount = Number(invoice.subtotal_amount || invoice.total_amount);

    // Calculate withholding
    const result = await this.calculator.calculateWithholding({
      amount: base_amount,
      concept_code,
      supplier_type,
      organization_id: context.organization_id!,
    });

    if (!result.applies) {
      return { ...result, saved: false };
    }

    // Get the concept for the ID
    const concept = await this.prisma.withholding_concepts.findFirst({
      where: {
        accounting_entity_id: accounting_entity.id,
        code: concept_code,
        is_active: true,
      },
    });

    if (!concept) {
      throw new VendixHttpException(ErrorCodes.WHT_CONCEPT_NOT_FOUND);
    }

    // Get UVT for the current year
    const year = new Date().getFullYear();
    const uvt = await this.prisma.uvt_values.findFirst({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: accounting_entity.id,
        year,
      },
    });

    // Save the calculation
    const calculation = await this.prisma.withholding_calculations.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id || null,
        accounting_entity_id: accounting_entity.id,
        invoice_id,
        supplier_id: invoice.supplier_id || null,
        concept_id: concept.id,
        base_amount: new Prisma.Decimal(base_amount),
        withholding_rate: new Prisma.Decimal(result.rate),
        withholding_amount: new Prisma.Decimal(result.withholding_amount),
        uvt_value_used: uvt ? uvt.value_cop : new Prisma.Decimal(0),
        year,
      },
    });

    // Emit event for auto-entry creation
    const net_amount = base_amount - result.withholding_amount;
    this.event_emitter.emit('withholding.applied', {
      organization_id: context.organization_id,
      store_id: context.store_id,
      accounting_entity_id: accounting_entity.id,
      invoice_id,
      base_amount,
      withholding_amount: result.withholding_amount,
      net_amount,
      concept_name: result.concept_name,
      supplier_name: invoice.supplier?.name || 'N/A',
      user_id: context.user_id,
    });

    return {
      ...result,
      saved: true,
      calculation_id: calculation.id,
      net_amount,
    };
  }

  // ===== Certificate Generation =====

  async generateCertificate(
    supplier_id: number,
    year: number,
  ): Promise<WithholdingCertificateData> {
    const context = RequestContextService.getContext()!;
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id!,
        store_id: context.store_id ?? null,
      });

    // Get supplier info
    const supplier = await this.prisma.suppliers.findFirst({
      where: { id: supplier_id },
    });

    if (!supplier) {
      throw new VendixHttpException(
        ErrorCodes.WHT_CALCULATION_ERROR,
        'Supplier not found',
      );
    }

    // Get all calculations for this supplier in the given year
    const calculations = await this.prisma.withholding_calculations.findMany({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: accounting_entity.id,
        supplier_id,
        year,
      },
      include: {
        concept: { select: { code: true, name: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    // Group by month
    const monthly_breakdown: Array<{
      month: number;
      concept: string;
      base: number;
      rate: number;
      amount: number;
    }> = [];

    let total_base = 0;
    let total_withheld = 0;

    for (const calc of calculations) {
      const month = calc.created_at
        ? new Date(calc.created_at).getMonth() + 1
        : 1;
      const base = Number(calc.base_amount);
      const amount = Number(calc.withholding_amount);
      const rate = Number(calc.withholding_rate);

      monthly_breakdown.push({
        month,
        concept: calc.concept?.name || 'N/A',
        base,
        rate,
        amount,
      });

      total_base += base;
      total_withheld += amount;
    }

    return {
      supplier_name: supplier.name,
      supplier_nit: supplier.tax_id || '',
      year,
      total_base: Math.round(total_base * 100) / 100,
      total_withheld: Math.round(total_withheld * 100) / 100,
      monthly_breakdown,
    };
  }

  // ===== Stats =====

  async getStats() {
    const context = RequestContextService.getContext()!;
    const now = new Date();
    const current_year = now.getFullYear();
    const current_month = now.getMonth();
    const start_of_month = new Date(current_year, current_month, 1);

    const [
      active_concepts,
      current_uvt,
      monthly_withholdings,
      yearly_withholdings,
    ] = await Promise.all([
      this.prisma.withholding_concepts.count({
        where: { is_active: true },
      }),
      this.prisma.uvt_values.findFirst({
        where: {
          organization_id: context.organization_id,
          year: current_year,
        },
      }),
      this.prisma.withholding_calculations.aggregate({
        where: {
          year: current_year,
          created_at: { gte: start_of_month },
        },
        _sum: { withholding_amount: true, base_amount: true },
        _count: true,
      }),
      this.prisma.withholding_calculations.aggregate({
        where: {
          year: current_year,
        },
        _sum: { withholding_amount: true, base_amount: true },
        _count: true,
      }),
    ]);

    return {
      active_concepts,
      current_uvt_value: current_uvt ? Number(current_uvt.value_cop) : null,
      current_uvt_year: current_uvt ? current_uvt.year : null,
      monthly: {
        total_withheld: Number(
          monthly_withholdings._sum.withholding_amount || 0,
        ),
        total_base: Number(monthly_withholdings._sum.base_amount || 0),
        count: monthly_withholdings._count,
      },
      yearly: {
        total_withheld: Number(
          yearly_withholdings._sum.withholding_amount || 0,
        ),
        total_base: Number(yearly_withholdings._sum.base_amount || 0),
        count: yearly_withholdings._count,
      },
    };
  }
}
