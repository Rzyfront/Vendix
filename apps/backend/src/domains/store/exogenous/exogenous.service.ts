import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { ExogenousGeneratorService } from './exogenous-generator.service';
import { ExogenousValidatorService } from './exogenous-validator.service';
import { ExogenousFileBuilderService } from './exogenous-file-builder.service';
import { EXOGENOUS_FORMATS, ExogenousFormatCode } from './constants/format-definitions';
import { GenerateReportDto, QueryReportsDto } from './dto';

@Injectable()
export class ExogenousService {
  private readonly logger = new Logger(ExogenousService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly generator: ExogenousGeneratorService,
    private readonly validator: ExogenousValidatorService,
    private readonly file_builder: ExogenousFileBuilderService,
  ) {}

  async findAll(query: QueryReportsDto) {
    const context = RequestContextService.getContext()!;
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      organization_id: context.organization_id,
    };
    if (query.fiscal_year) where.fiscal_year = query.fiscal_year;
    if (query.status) where.status = query.status;
    if (context.store_id) where.store_id = context.store_id;

    const [data, total] = await Promise.all([
      (this.prisma as any).client.exogenous_reports.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { exogenous_report_lines: true } } },
      }),
      (this.prisma as any).client.exogenous_reports.count({ where }),
    ]);

    return {
      data: data.map((r: any) => ({
        ...r,
        format_name: EXOGENOUS_FORMATS[r.format_code as ExogenousFormatCode]?.name || r.format_code,
        line_count: r._count.exogenous_report_lines,
      })),
      meta: { total, page, limit, total_pages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const context = RequestContextService.getContext()!;

    const report = await (this.prisma as any).client.exogenous_reports.findFirst({
      where: { id, organization_id: context.organization_id },
      include: { _count: { select: { exogenous_report_lines: true } } },
    });

    if (!report) {
      throw new VendixHttpException(ErrorCodes.EXO_REPORT_NOT_FOUND);
    }

    return {
      ...report,
      format_name: EXOGENOUS_FORMATS[report.format_code as ExogenousFormatCode]?.name || report.format_code,
      line_count: report._count.exogenous_report_lines,
    };
  }

  async getReportLines(id: number, page = 1, limit = 50) {
    const context = RequestContextService.getContext()!;

    // Verify report belongs to org
    const report = await (this.prisma as any).client.exogenous_reports.findFirst({
      where: { id, organization_id: context.organization_id },
      select: { id: true },
    });

    if (!report) {
      throw new VendixHttpException(ErrorCodes.EXO_REPORT_NOT_FOUND);
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      (this.prisma as any).client.exogenous_report_lines.findMany({
        where: { report_id: id },
        orderBy: { third_party_nit: 'asc' },
        skip,
        take: limit,
      }),
      (this.prisma as any).client.exogenous_report_lines.count({ where: { report_id: id } }),
    ]);

    return { data, meta: { total, page, limit, total_pages: Math.ceil(total / limit) } };
  }

  async generateReport(dto: GenerateReportDto) {
    const context = RequestContextService.getContext()!;
    const { fiscal_year, format_code } = dto;

    // Validate format code
    if (!EXOGENOUS_FORMATS[format_code as ExogenousFormatCode]) {
      throw new VendixHttpException(ErrorCodes.EXO_INVALID_FORMAT);
    }

    const org_id = context.organization_id!;
    const store_id = context.store_id || null;

    // Upsert report record
    let report = await (this.prisma as any).client.exogenous_reports.findFirst({
      where: { organization_id: org_id, fiscal_year, format_code },
    });

    if (report) {
      report = await (this.prisma as any).client.exogenous_reports.update({
        where: { id: report.id },
        data: { status: 'generating', updated_at: new Date() },
      });
    } else {
      report = await (this.prisma as any).client.exogenous_reports.create({
        data: {
          organization_id: org_id,
          store_id,
          fiscal_year,
          format_code,
          status: 'generating',
          created_by_user_id: context.user_id || null,
        },
      });
    }

    try {
      // Generate lines based on format
      let lines: any[] = [];

      switch (format_code) {
        case '1001':
          lines = await this.generator.generateFormat1001(org_id, store_id, fiscal_year);
          break;
        case '1003':
          lines = await this.generator.generateFormat1003(org_id, store_id, fiscal_year);
          break;
        case '1005':
          lines = await this.generator.generateFormat1005(org_id, store_id, fiscal_year);
          break;
        case '1006':
          lines = await this.generator.generateFormat1006(org_id, store_id, fiscal_year);
          break;
        case '1007':
          lines = await this.generator.generateFormat1007(org_id, store_id, fiscal_year);
          break;
        case '1008':
          lines = await this.generator.generateFormat1008(org_id, store_id, fiscal_year);
          break;
        case '1009':
          lines = await this.generator.generateFormat1009(org_id, store_id, fiscal_year);
          break;
        default:
          this.logger.warn(`Format ${format_code} generator not yet implemented`);
          lines = [];
      }

      // Delete old lines and insert new ones in transaction
      await (this.prisma as any).client.$transaction([
        (this.prisma as any).client.exogenous_report_lines.deleteMany({
          where: { report_id: report.id },
        }),
        ...(lines.length > 0
          ? [(this.prisma as any).client.exogenous_report_lines.createMany({
              data: lines.map((line: any) => ({
                report_id: report.id,
                third_party_nit: line.third_party_nit,
                third_party_name: line.third_party_name,
                third_party_dv: line.third_party_dv || null,
                concept_code: line.concept_code,
                payment_amount: line.payment_amount,
                tax_amount: line.tax_amount,
                withholding_amount: line.withholding_amount,
                line_data: line.line_data || null,
              })),
            })]
          : []),
      ]);

      // Update report
      const total_amount = lines.reduce((sum, l) => sum + l.payment_amount, 0);

      const updated_report = await (this.prisma as any).client.exogenous_reports.update({
        where: { id: report.id },
        data: {
          status: 'generated',
          total_records: lines.length,
          total_amount,
          generated_at: new Date(),
          updated_at: new Date(),
        },
      });

      return {
        ...updated_report,
        format_name: EXOGENOUS_FORMATS[format_code as ExogenousFormatCode]?.name,
      };
    } catch (error) {
      this.logger.error(`Failed to generate format ${format_code}: ${error.message}`);

      await (this.prisma as any).client.exogenous_reports.update({
        where: { id: report.id },
        data: { status: 'draft', validation_errors: { error: error.message } },
      });

      throw new VendixHttpException(ErrorCodes.EXO_GENERATION_FAILED);
    }
  }

  async validateYear(fiscal_year: number) {
    const errors = await this.validator.validateCompleteness(fiscal_year);
    return {
      fiscal_year,
      is_complete: errors.length === 0,
      error_count: errors.length,
      errors,
    };
  }

  async markAsSubmitted(id: number) {
    const context = RequestContextService.getContext()!;

    const report = await (this.prisma as any).client.exogenous_reports.findFirst({
      where: { id, organization_id: context.organization_id },
    });

    if (!report) {
      throw new VendixHttpException(ErrorCodes.EXO_REPORT_NOT_FOUND);
    }

    return (this.prisma as any).client.exogenous_reports.update({
      where: { id },
      data: { status: 'submitted', submitted_at: new Date(), updated_at: new Date() },
    });
  }

  async getStats(fiscal_year: number) {
    const context = RequestContextService.getContext()!;
    const where: any = {
      organization_id: context.organization_id,
      fiscal_year,
    };
    if (context.store_id) where.store_id = context.store_id;

    const reports = await (this.prisma as any).client.exogenous_reports.findMany({
      where,
      select: { status: true, format_code: true },
    });

    const by_status: Record<string, number> = {};
    const formats_generated = new Set<string>();

    for (const r of reports) {
      by_status[r.status] = (by_status[r.status] || 0) + 1;
      formats_generated.add(r.format_code);
    }

    return {
      total_reports: reports.length,
      by_status,
      formats_generated: Array.from(formats_generated),
    };
  }

  async downloadReport(id: number, format: string = 'txt') {
    const context = RequestContextService.getContext()!;

    const report = await (this.prisma as any).client.exogenous_reports.findFirst({
      where: { id, organization_id: context.organization_id },
    });

    if (!report) {
      throw new VendixHttpException(ErrorCodes.EXO_REPORT_NOT_FOUND);
    }

    if (report.status !== 'generated' && report.status !== 'submitted') {
      throw new VendixHttpException(ErrorCodes.EXO_DOWNLOAD_FAILED);
    }

    try {
      // Si ya tiene file_key, retornar URL firmada directamente
      if (report.file_key) {
        const download_url = await this.file_builder.getDownloadUrl(report.file_key);
        return {
          download_url,
          file_key: report.file_key,
          format_code: report.format_code,
          fiscal_year: report.fiscal_year,
        };
      }

      // Generar TXT: obtener todas las lineas del reporte
      const lines = await (this.prisma as any).client.exogenous_report_lines.findMany({
        where: { report_id: id },
        orderBy: { third_party_nit: 'asc' },
      });

      // Construir y subir a S3
      const file_key = await this.file_builder.buildAndUpload(
        context.organization_id!,
        id,
        report.format_code,
        report.fiscal_year,
        lines,
      );

      // Guardar file_key en el reporte
      await (this.prisma as any).client.exogenous_reports.update({
        where: { id },
        data: { file_key, updated_at: new Date() },
      });

      // Obtener URL firmada
      const download_url = await this.file_builder.getDownloadUrl(file_key);

      return {
        download_url,
        file_key,
        format_code: report.format_code,
        fiscal_year: report.fiscal_year,
      };
    } catch (error) {
      this.logger.error(`Failed to generate download for report ${id}: ${error.message}`);
      throw new VendixHttpException(ErrorCodes.EXO_DOWNLOAD_FAILED);
    }
  }
}
