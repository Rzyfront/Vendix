import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { TemplatesService } from '../../../data-collection/templates.service';
import { isStoreCustomer } from '../shared/crm-access';
import { CustomerDataSheetValueDto } from './dto/customer-data-sheet.dto';

type ValueRow = Prisma.entity_metadata_valuesGetPayload<{
  include: { field: true };
}>;
type TemplateWithStructure = Awaited<ReturnType<TemplatesService['findOne']>>;

type FieldItem = {
  metadata_field: {
    id: number;
    entity_type: string;
    field_type: string;
    is_active: boolean;
  };
};
type ChildSection = { items: FieldItem[] };
type Section = ChildSection & { child_sections: ChildSection[] };

/**
 * Attachments allowed in the data sheet, by MIME type, with the extensions
 * that type may carry. Anything else (SVG, HTML, scripts, archives) is
 * refused: files are served from S3 with their content type.
 */
const ALLOWED_ATTACHMENTS: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
};

const isCustomerField = (item: FieldItem) =>
  item.metadata_field.entity_type === 'customer' &&
  item.metadata_field.is_active;

/**
 * Customer data sheet (QUI-1043 H5/H8): the Data Collection template a
 * customer is filled with, read from its profile and from the opportunity
 * detail. The answers live in `entity_metadata_values` with
 * `entity_type = customer` and `entity_id = customer id`, so both screens show
 * the same sheet.
 *
 * The effective template is the one picked on the customer
 * (`store_users.crm_data_template_id`) while it stays an active customer
 * template; otherwise the store's CRM default (`is_crm_default`). Only the
 * template's active customer fields are part of the sheet: a template may
 * also hold booking fields, which are not answered here.
 *
 * Files are uploaded under the customer's own S3 prefix and the answer keeps
 * the key; the URL is signed on read.
 */
@Injectable()
export class CustomerDataSheetService {
  private readonly logger = new Logger(CustomerDataSheetService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly templates: TemplatesService,
    private readonly s3: S3Service,
    private readonly s3Path: S3PathHelper,
  ) {}

  async get(customerId: number) {
    await this.assertCustomer(customerId);
    return this.build(customerId);
  }

  /** `null` goes back to the CRM default template. */
  async setTemplate(customerId: number, templateId: number | null) {
    await this.assertCustomer(customerId);
    if (templateId !== null) {
      const template = await this.prisma.data_collection_templates.findFirst({
        where: { id: templateId },
        select: { entity_type: true, status: true },
      });
      if (!template) throw new VendixHttpException(ErrorCodes.DCOL_FIND_001);
      if (template.entity_type !== 'customer' || template.status !== 'active') {
        throw new VendixHttpException(ErrorCodes.DCOL_CRM_001);
      }
    }
    await this.prisma.store_users.updateMany({
      where: { user_id: customerId },
      data: { crm_data_template_id: templateId },
    });
    return this.build(customerId);
  }

  /**
   * Each entry is the whole answer of one field of the effective template;
   * an entry with every value null deletes it. Everything is validated
   * before the first write.
   */
  async saveValues(customerId: number, values: CustomerDataSheetValueDto[]) {
    await this.assertCustomer(customerId);
    const { template } = await this.resolveTemplate(customerId);
    const fields = new Map(
      this.templateItems(template).map((item) => [
        item.metadata_field.id,
        item.metadata_field,
      ]),
    );

    const fileIds = values
      .filter((value) => fields.get(value.field_id)?.field_type === 'file')
      .map((value) => value.field_id);
    const storedFiles = fileIds.length
      ? await this.prisma.entity_metadata_values.findMany({
          where: {
            entity_type: 'customer',
            entity_id: customerId,
            field_id: { in: fileIds },
          },
          select: { field_id: true, value_text: true },
        })
      : [];
    const prefix = fileIds.length ? await this.filePrefix(customerId) : '';

    for (const value of values) {
      const field = fields.get(value.field_id);
      if (!field) throw new VendixHttpException(ErrorCodes.CRM_DATA_SHEET_001);
      if (field.field_type === 'file' && value.value_text) {
        const unchanged = storedFiles.some(
          (row) =>
            row.field_id === value.field_id &&
            row.value_text === value.value_text,
        );
        if (!unchanged && !this.isOwnFileKey(value.value_text, prefix)) {
          throw new VendixHttpException(ErrorCodes.CRM_DATA_SHEET_002);
        }
      }
    }

    const storeId = this.storeId();
    for (const value of values) {
      const data = {
        value_text: value.value_text ?? null,
        value_number: value.value_number ?? null,
        value_date: value.value_date
          ? new Date(`${value.value_date}T00:00:00.000Z`)
          : null,
        value_bool: value.value_bool ?? null,
        value_json:
          value.value_json === undefined || value.value_json === null
            ? Prisma.DbNull
            : (value.value_json as Prisma.InputJsonValue),
      };
      const empty =
        data.value_text === null &&
        data.value_number === null &&
        data.value_date === null &&
        data.value_bool === null &&
        data.value_json === Prisma.DbNull;
      if (empty) {
        await this.prisma.entity_metadata_values.deleteMany({
          where: {
            field_id: value.field_id,
            entity_type: 'customer',
            entity_id: customerId,
          },
        });
        continue;
      }
      await this.prisma.entity_metadata_values.upsert({
        where: {
          field_id_entity_type_entity_id: {
            field_id: value.field_id,
            entity_type: 'customer',
            entity_id: customerId,
          },
        },
        create: {
          store_id: storeId,
          field_id: value.field_id,
          entity_type: 'customer',
          entity_id: customerId,
          ...data,
        },
        update: { ...data, updated_at: new Date() },
      });
    }
    return this.build(customerId);
  }

  /** Uploads one attachment under the customer's own prefix. */
  async upload(customerId: number, file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new VendixHttpException(ErrorCodes.UPLOAD_FILE_001);
    const original = file.originalname || 'archivo';
    const mimetype = (file.mimetype ?? '').toLowerCase();
    const extension = original.split('.').pop()?.toLowerCase() ?? '';
    if (
      !original.includes('.') ||
      !ALLOWED_ATTACHMENTS[mimetype]?.includes(extension)
    ) {
      throw new VendixHttpException(ErrorCodes.CRM_DATA_SHEET_003);
    }
    await this.assertCustomer(customerId);
    const prefix = await this.filePrefix(customerId);
    const safe =
      original
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w.-]+/g, '_')
        .replace(/\.{2,}/g, '.')
        .replace(/_+/g, '_')
        .slice(-120) || 'archivo';
    const stamp = Date.now();
    let key: string;
    try {
      if (mimetype.startsWith('image/')) {
        const stem = safe.replace(/\.[^.]*$/, '') || 'imagen';
        const result = await this.s3.uploadImage(
          file.buffer,
          `${prefix}/${stamp}-${stem}.webp`,
        );
        key = result.key;
      } else {
        key = await this.s3.uploadFile(
          file.buffer,
          `${prefix}/${stamp}-${safe}`,
          mimetype,
        );
      }
    } catch (error) {
      this.logger.error(
        `Customer ${customerId} attachment upload failed: ${(error as Error).message}`,
      );
      throw new VendixHttpException(ErrorCodes.UPLOAD_FAILED_001);
    }
    return {
      key,
      url: (await this.sign(key)) ?? null,
      original_name: original,
    };
  }

  private async build(customerId: number) {
    const { selectedId, defaultId, templates, template } =
      await this.resolveTemplate(customerId);
    const fieldIds = new Set(
      this.templateItems(template).map((item) => item.metadata_field.id),
    );
    const rows = await this.prisma.entity_metadata_values.findMany({
      where: { entity_type: 'customer', entity_id: customerId },
      include: { field: true },
      orderBy: [{ field: { sort_order: 'asc' } }, { id: 'asc' }],
    });
    const mapped = await Promise.all(rows.map((row) => this.toValue(row)));
    return {
      customer_id: customerId,
      selected_template_id: selectedId,
      default_template_id: defaultId,
      template,
      templates,
      values: mapped.filter((value) => fieldIds.has(value.field_id)),
      other_values: mapped.filter((value) => !fieldIds.has(value.field_id)),
    };
  }

  /**
   * The picked template while it is an active customer template, otherwise
   * the CRM default. `selectedId` is null when the pick is no longer valid.
   */
  private async resolveTemplate(customerId: number) {
    const [link, templates] = await Promise.all([
      this.prisma.store_users.findFirst({
        where: { user_id: customerId },
        select: { crm_data_template_id: true },
      }),
      this.prisma.data_collection_templates.findMany({
        where: { entity_type: 'customer', status: 'active' },
        select: { id: true, name: true, is_crm_default: true },
        orderBy: [{ is_crm_default: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const picked = link?.crm_data_template_id ?? null;
    const selectedId =
      picked !== null && templates.some((row) => row.id === picked)
        ? picked
        : null;
    const defaultId = templates.find((row) => row.is_crm_default)?.id ?? null;
    const effectiveId = selectedId ?? defaultId;
    const template =
      effectiveId !== null
        ? this.customerOnly(await this.templates.findOne(effectiveId))
        : null;
    return { selectedId, defaultId, templates, template };
  }

  /** Keeps only active customer fields and drops what ends up empty. */
  private customerOnly(template: TemplateWithStructure) {
    const { products: _products, tabs, sections, ...rest } = template;
    return {
      ...rest,
      tabs: tabs
        .map((tab) => ({
          ...tab,
          sections: this.pruneSections(tab.sections),
        }))
        .filter((tab) => tab.sections.length > 0),
      sections: this.pruneSections(sections),
    };
  }

  private pruneSections<S extends Section>(sections: S[]): S[] {
    return sections
      .map((section) => {
        const child_sections = section.child_sections
          .map((child) => ({
            ...child,
            items: child.items.filter(isCustomerField),
          }))
          .filter((child) => child.items.length > 0);
        return {
          ...section,
          items: section.items.filter(isCustomerField),
          child_sections,
        } as S;
      })
      .filter(
        (section) =>
          section.items.length > 0 || section.child_sections.length > 0,
      );
  }

  private templateItems(
    template: ReturnType<CustomerDataSheetService['customerOnly']> | null,
  ) {
    if (!template) return [];
    const walk = (section: Section): FieldItem[] => [
      ...section.items,
      ...section.child_sections.flatMap((child) => child.items),
    ];
    return [
      ...template.tabs.flatMap((tab) => tab.sections.flatMap(walk)),
      ...template.sections.flatMap(walk),
    ];
  }

  private async toValue(row: ValueRow) {
    const isFile = row.field.field_type === 'file';
    return {
      field_id: row.field_id,
      field_key: row.field.field_key,
      label: row.field.label,
      field_type: row.field.field_type,
      value_text: row.value_text,
      value_number: row.value_number?.toString() ?? null,
      value_date: row.value_date
        ? row.value_date.toISOString().slice(0, 10)
        : null,
      value_bool: row.value_bool,
      value_json: row.value_json ?? null,
      file_url: isFile && row.value_text ? await this.sign(row.value_text) : null,
      updated_at: row.updated_at,
    };
  }

  private async sign(key: string): Promise<string | null> {
    try {
      return (await this.s3.signUrl(key)) ?? null;
    } catch (error) {
      this.logger.warn(`Could not sign ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  /** `organizations/{org}/stores/{store}/data-collection/customers/{id}`. */
  private async filePrefix(customerId: number): Promise<string> {
    const storeId = this.storeId();
    const store = await this.prisma.withoutScope().stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        organizations: { select: { id: true, slug: true } },
      },
    });
    if (!store) throw new VendixHttpException(ErrorCodes.UPLOAD_STORE_001);
    const base = this.s3Path.buildStorePath(store.organizations, store);
    return `${base}/data-collection/customers/${customerId}`;
  }

  private isOwnFileKey(key: string, prefix: string): boolean {
    return (
      key.startsWith(`${prefix}/`) &&
      !key.includes('..') &&
      !key.slice(prefix.length + 1).includes('/')
    );
  }

  private async assertCustomer(customerId: number) {
    if (!(await isStoreCustomer(this.prisma, customerId))) {
      throw new VendixHttpException(ErrorCodes.CRM_CUSTOMER_001);
    }
  }

  private storeId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }
}
