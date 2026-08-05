import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateResolutionDto } from './dto/create-resolution.dto';
import { UpdateResolutionDto } from './dto/update-resolution.dto';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { parsePlausibleFiscalDate } from '@common/utils/fiscal-date.util';

@Injectable()
export class ResolutionsService {
  private readonly logger = new Logger(ResolutionsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll() {
    return this.prisma.invoice_resolutions.findMany({
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number) {
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id },
    });

    if (!resolution) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_002);
    }

    return resolution;
  }

  async create(dto: CreateResolutionDto) {
    const context = this.getContext();
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id!,
        store_id: context.store_id ?? null,
      });

    // La base restringe la tabla con `invoice_resolutions_entity_prefix_uidx`
    // sobre `(accounting_entity_id, prefix)` — sin `document_type` y sin
    // `is_active`. Un prefijo pertenece a UNA fila por entidad contable, que es
    // como la DIAN lo autoriza: por NIT. Sin este pre-chequeo el duplicado
    // llegaba a Postgres y volvía como P2002 crudo, o sea un 500 sin pista.
    const duplicate = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          accounting_entity_id: accounting_entity.id,
          prefix: dto.prefix,
        },
        select: {
          id: true,
          resolution_number: true,
          document_type: true,
          is_active: true,
        },
      });
    if (duplicate) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_007,
        `Ya existe una resolución con prefijo "${dto.prefix}" (número ${
          duplicate.resolution_number
        }${
          duplicate.is_active ? '' : ', desactivada'
        }). La DIAN autoriza el prefijo por NIT, así que no puede repetirse: edita esa resolución o usa otro prefijo.`,
        {
          resolution_id: duplicate.id,
          prefix: dto.prefix,
          document_type: duplicate.document_type,
          is_active: duplicate.is_active,
        },
      );
    }

    const resolution = await this.prisma.invoice_resolutions.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        accounting_entity_id: accounting_entity.id,
        document_type: dto.document_type || 'sales_invoice',
        resolution_number: dto.resolution_number,
        // Validadas, no solo convertidas: el escáner por IA de este mismo módulo
        // y un año a medio teclear en `<input type="date">` producen fechas ISO
        // válidas pero imposibles, que después viajan al XML del documento.
        resolution_date: parsePlausibleFiscalDate(
          'fecha de resolución',
          dto.resolution_date,
        ),
        prefix: dto.prefix,
        range_from: dto.range_from,
        range_to: dto.range_to,
        current_number: dto.range_from - 1, // Start just before range_from
        valid_from: parsePlausibleFiscalDate('válida desde', dto.valid_from),
        valid_to: parsePlausibleFiscalDate('válida hasta', dto.valid_to),
        is_active: dto.is_active ?? true,
        technical_key: dto.technical_key,
      },
    });

    this.logger.log(
      `Resolution ${resolution.resolution_number} created (prefix: ${resolution.prefix}, range: ${resolution.range_from}-${resolution.range_to})`,
    );
    return resolution;
  }

  async update(id: number, dto: UpdateResolutionDto) {
    await this.findOne(id);

    const update_data: any = {
      ...(dto.resolution_number && {
        resolution_number: dto.resolution_number,
      }),
      ...(dto.resolution_date && {
        resolution_date: parsePlausibleFiscalDate(
          'fecha de resolución',
          dto.resolution_date,
        ),
      }),
      ...(dto.prefix && { prefix: dto.prefix }),
      ...(dto.document_type && { document_type: dto.document_type }),
      ...(dto.range_from !== undefined && { range_from: dto.range_from }),
      ...(dto.range_to !== undefined && { range_to: dto.range_to }),
      ...(dto.valid_from && {
        valid_from: parsePlausibleFiscalDate('válida desde', dto.valid_from),
      }),
      ...(dto.valid_to && {
        valid_to: parsePlausibleFiscalDate('válida hasta', dto.valid_to),
      }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.technical_key !== undefined && {
        technical_key: dto.technical_key,
      }),
    };

    const updated = await this.prisma.invoice_resolutions.update({
      where: { id },
      data: update_data,
    });

    this.logger.log(`Resolution #${id} updated`);
    return updated;
  }

  async remove(id: number) {
    const resolution = await this.findOne(id);

    // Check if resolution has been used
    const usage_count = await this.prisma.invoices.count({
      where: { resolution_id: id },
    });

    if (usage_count > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución tiene ${usage_count} documento(s) emitido(s). Desactívala en vez de borrarla.`,
        { resolution_id: id, issued_invoices: usage_count },
      );
    }

    // `current_number` starts at range_from - 1. Reaching range_from means the
    // DIAN already saw a consecutive from this range — for instance a habilitación
    // test set, which burns numbers without writing rows in `invoices`. Deleting
    // the row would erase the only record of which numbers were consumed.
    if (resolution.current_number >= resolution.range_from) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución ya consumió numeración ante la DIAN (va en ${resolution.current_number}). Desactívala en vez de borrarla.`,
        { resolution_id: id, current_number: resolution.current_number },
      );
    }

    await this.prisma.invoice_resolutions.delete({
      where: { id },
    });

    this.logger.log(`Resolution #${id} deleted`);
  }
}
