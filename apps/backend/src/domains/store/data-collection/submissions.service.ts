import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { MetadataValuesService } from '../metadata/metadata-values.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import {
  resolveEntityId,
  buildEntityQueries,
  EntityContext,
} from './utils/entity-resolver.util';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { FieldResponseDto } from './dto/submit-response.dto';
import { Observable } from 'rxjs';
import * as crypto from 'crypto';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);
  private readonly EXPIRATION_DAYS = 7;

  private readonly SUBMISSION_INCLUDE = {
    template: {
      include: {
        tabs: {
          include: {
            sections: {
              include: {
                items: {
                  include: { metadata_field: true },
                  orderBy: { sort_order: 'asc' as const },
                },
                child_sections: {
                  include: {
                    items: {
                      include: { metadata_field: true },
                      orderBy: { sort_order: 'asc' as const },
                    },
                  },
                  orderBy: { sort_order: 'asc' as const },
                },
              },
              where: { parent_section_id: { equals: null } },
              orderBy: { sort_order: 'asc' as const },
            },
          },
          orderBy: { sort_order: 'asc' as const },
        },
        sections: {
          include: {
            items: {
              include: { metadata_field: true },
              orderBy: { sort_order: 'asc' as const },
            },
            child_sections: {
              include: {
                items: {
                  include: { metadata_field: true },
                  orderBy: { sort_order: 'asc' as const },
                },
              },
              orderBy: { sort_order: 'asc' as const },
            },
          },
          where: {
            tab_id: { equals: null },
            parent_section_id: { equals: null },
          },
          orderBy: { sort_order: 'asc' as const },
        },
      } as any,
    },
    booking: {
      include: {
        product: {
          select: { id: true, name: true, service_instructions: true },
        },
        provider: { select: { id: true, display_name: true } },
        customer: { select: { id: true, first_name: true, last_name: true } },
      },
    },
    customer: {
      select: {
        id: true,
        first_name: true,
        last_name: true,
        document_type: true,
        document_number: true,
      },
    },
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly metadataValues: MetadataValuesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly aiEngine: AIEngineService,
  ) {}

  async createSubmission(dto: CreateSubmissionDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id)
      throw new ForbiddenException('Store context required');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.EXPIRATION_DAYS);

    const submission = await this.prisma.data_collection_submissions.create({
      data: {
        store_id: context.store_id,
        template_id: dto.template_id,
        booking_id: dto.booking_id,
        customer_id: dto.customer_id,
        token,
        expires_at: expiresAt,
      },
      include: this.SUBMISSION_INCLUDE,
    });

    this.logger.log(
      `Created submission ${submission.id} with token ${token.substring(0, 8)}...`,
    );

    this.eventEmitter.emit('data_collection.submission_created', {
      store_id: context.store_id,
      submission_id: submission.id,
      token: submission.token,
      booking_id: dto.booking_id,
      customer_id: dto.customer_id,
    });

    return submission;
  }

  async getByToken(token: string) {
    const submission = await this.prisma
      .withoutScope()
      .data_collection_submissions.findUnique({
        where: { token },
        include: this.SUBMISSION_INCLUDE,
      });

    if (!submission) throw new VendixHttpException(ErrorCodes.DCOL_TOKEN_001);
    if (submission.expires_at < new Date())
      throw new VendixHttpException(ErrorCodes.DCOL_TOKEN_001);
    if (
      submission.status === 'completed' ||
      submission.status === 'submitted'
    ) {
      throw new VendixHttpException(ErrorCodes.DCOL_TOKEN_002);
    }

    return this.populateResponsesFromMetadata(submission);
  }

  async saveStepResponses(
    token: string,
    stepIndex: number,
    responses: FieldResponseDto[],
  ) {
    const submission = await this.getByToken(token);

    // Build entity context from submission
    const entityCtx: EntityContext = {
      customer_id: submission.customer_id,
      booking_id: submission.booking_id,
      order_id: submission.booking?.order_id ?? null,
    };

    // Group responses by entity_type for batch writes
    const byEntity = new Map<
      string,
      { entityType: string; entityId: number; values: any[] }
    >();

    for (const resp of responses) {
      // Look up the field to get its entity_type
      const field = await this.prisma
        .withoutScope()
        .entity_metadata_fields.findUnique({
          where: { id: resp.field_id },
          select: { id: true, entity_type: true },
        });
      if (!field) continue;

      const entityId = resolveEntityId(field.entity_type, entityCtx);
      if (!entityId) {
        this.logger.warn(
          `Cannot resolve entity for field ${resp.field_id} (${field.entity_type})`,
        );
        continue;
      }

      const key = `${field.entity_type}:${entityId}`;
      if (!byEntity.has(key)) {
        byEntity.set(key, {
          entityType: field.entity_type,
          entityId,
          values: [],
        });
      }
      byEntity.get(key)!.values.push({
        field_id: resp.field_id,
        value_text: resp.value_text,
        value_number: resp.value_number,
        value_date: resp.value_date,
        value_bool: resp.value_bool,
        value_json: resp.value_json,
      });
    }

    // Write to entity_metadata_values
    for (const [, group] of byEntity) {
      await this.metadataValues.setValuesUnscoped(
        submission.store_id,
        group.entityType,
        group.entityId,
        group.values,
      );
    }

    // Update current step
    await this.prisma.withoutScope().data_collection_submissions.update({
      where: { id: submission.id },
      data: {
        current_step: stepIndex + 1,
        status: 'in_progress',
        updated_at: new Date(),
      },
    });

    return { success: true, current_step: stepIndex + 1 };
  }

  async submitFinal(token: string) {
    const submission = await this.prisma
      .withoutScope()
      .data_collection_submissions.findUnique({
        where: { token },
        include: {
          booking: true,
        },
      });

    if (!submission) throw new VendixHttpException(ErrorCodes.DCOL_FIND_002);
    if (
      submission.status === 'completed' ||
      submission.status === 'submitted'
    ) {
      throw new VendixHttpException(ErrorCodes.DCOL_TOKEN_002);
    }

    // Build entity context
    const entityCtx: EntityContext = {
      customer_id: submission.customer_id,
      booking_id: submission.booking_id,
      order_id: (submission.booking as any)?.order_id ?? null,
    };

    // Validate required fields from entity_metadata_values
    const template = await this.prisma
      .withoutScope()
      .data_collection_templates.findUnique({
        where: { id: submission.template_id },
        include: {
          sections: {
            include: {
              items: {
                where: { is_required: true },
                include: { metadata_field: true },
              },
              child_sections: {
                include: {
                  items: {
                    where: { is_required: true },
                    include: { metadata_field: true },
                  },
                },
              },
            },
          } as any,
        },
      });

    if (template) {
      const requiredItems = (template as any).sections.flatMap((s: any) => [
        ...s.items,
        ...(s.child_sections || []).flatMap((cs: any) => cs.items),
      ]);

      // Load all metadata values for this context
      const allValues: any[] = [];
      for (const q of buildEntityQueries(entityCtx)) {
        const vals = await this.metadataValues.getValuesByStoreAndEntity(
          submission.store_id,
          q.entityType,
          q.entityId,
        );
        allValues.push(...vals);
      }
      const answeredFieldIds = new Set(allValues.map((v: any) => v.field_id));

      const missing = requiredItems.filter(
        (item: any) => !answeredFieldIds.has(item.metadata_field_id),
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `Faltan campos obligatorios: ${missing.length} campos sin responder`,
        );
      }
    }

    // Mark as completed — data already in entity_metadata_values
    const updated = await this.prisma
      .withoutScope()
      .data_collection_submissions.update({
        where: { id: submission.id },
        data: {
          status: 'completed',
          submitted_at: new Date(),
          processed_at: new Date(),
          updated_at: new Date(),
        },
      });

    this.logger.log(`Submission ${submission.id} completed`);

    this.eventEmitter.emit('data_collection.submitted', {
      store_id: submission.store_id,
      submission_id: submission.id,
      booking_id: submission.booking_id,
      customer_id: submission.customer_id,
    });

    // Try AI prediagnosis in background
    try {
      const aiApp = await this.aiEngine.getApplication(
        'consultation_prediagnosis',
      );
      if (aiApp?.is_active) {
        const fullSubmission = await this.findOne(submission.id);
        const variables = await this.buildPrediagnosisVariables(fullSubmission);
        const result = await this.aiEngine.run(
          'consultation_prediagnosis',
          variables,
        );
        if ((result as any)?.text) {
          await this.savePrediagnosis(submission.id, (result as any).text);
          this.logger.log(
            `Prediagnosis generated for submission ${submission.id}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Prediagnosis skipped for submission ${submission.id}: ${error.message}`,
      );
    }

    return updated;
  }

  async findByStore(status?: string) {
    const where: any = {};
    if (status) where.status = status;

    return this.prisma.data_collection_submissions.findMany({
      where,
      include: {
        template: { select: { id: true, name: true } },
        booking: {
          select: {
            id: true,
            booking_number: true,
            date: true,
            start_time: true,
          },
        },
        customer: { select: { id: true, first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(submissionId: number) {
    const submission = await this.prisma.data_collection_submissions.findUnique(
      {
        where: { id: submissionId },
        include: this.SUBMISSION_INCLUDE,
      },
    );
    if (!submission) throw new VendixHttpException(ErrorCodes.DCOL_FIND_002);

    // Compute public form URL using the store's ecommerce domain
    const formUrl = await this.buildPublicFormUrl(
      submission.store_id,
      submission.token,
    );
    const populated = await this.populateResponsesFromMetadata(submission);
    return { ...populated, form_url: formUrl };
  }

  private async buildPublicFormUrl(
    storeId: number,
    token: string,
  ): Promise<string> {
    try {
      const ecommerceDomain = await this.prisma.domain_settings.findFirst({
        where: { store_id: storeId, app_type: 'STORE_ECOMMERCE' as any },
      });
      if (ecommerceDomain?.hostname) {
        return `https://${ecommerceDomain.hostname}/preconsulta/${token}`;
      }
      const primaryDomain = await this.prisma.domain_settings.findFirst({
        where: { store_id: storeId, is_primary: true },
      });
      if (primaryDomain?.hostname) {
        return `https://${primaryDomain.hostname}/preconsulta/${token}`;
      }
    } catch {
      /* fallback */
    }
    return `https://vendix.com/preconsulta/${token}`;
  }

  async getSubmissionByBooking(bookingId: number) {
    const submission = await this.prisma.data_collection_submissions.findFirst({
      where: { booking_id: bookingId },
      include: this.SUBMISSION_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return this.populateResponsesFromMetadata(submission);
  }

  async savePrediagnosis(submissionId: number, markdown: string) {
    const submission = await this.prisma
      .withoutScope()
      .data_collection_submissions.findUnique({
        where: { id: submissionId },
        select: { store_id: true },
      });

    await this.prisma.withoutScope().data_collection_submissions.update({
      where: { id: submissionId },
      data: {
        ai_prediagnosis: markdown,
        processed_at: new Date(),
        status: 'completed',
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('data_collection.prediagnosis_ready', {
      submission_id: submissionId,
      store_id: submission?.store_id,
    });
  }

  streamPrediagnosis(submissionId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          const submission = await this.findOne(submissionId);
          const variables = await this.buildPrediagnosisVariables(submission);
          let accumulatedText = '';

          try {
            for await (const chunk of this.aiEngine.runStream(
              'consultation_prediagnosis',
              variables,
            )) {
              if (chunk.type === 'text' && chunk.content) {
                accumulatedText += chunk.content;
                subscriber.next({
                  data: JSON.stringify({
                    type: 'text',
                    content: chunk.content,
                  }),
                } as MessageEvent);
              }
              if (chunk.type === 'done') {
                if (accumulatedText) {
                  await this.savePrediagnosis(submissionId, accumulatedText);
                }
                subscriber.next({
                  data: JSON.stringify({ type: 'done' }),
                } as MessageEvent);
                subscriber.complete();
                return;
              }
            }
          } catch {
            const result = await this.aiEngine.run(
              'consultation_prediagnosis',
              variables,
            );
            if (result?.content) {
              await this.savePrediagnosis(submissionId, result.content);
              subscriber.next({
                data: JSON.stringify({ type: 'text', content: result.content }),
              } as MessageEvent);
            }
            subscriber.next({
              data: JSON.stringify({ type: 'done' }),
            } as MessageEvent);
            subscriber.complete();
          }
        } catch (error: any) {
          subscriber.next({
            data: JSON.stringify({ type: 'error', message: error.message }),
          } as MessageEvent);
          subscriber.complete();
        }
      })();
    });
  }

  private async populateResponsesFromMetadata(submission: any): Promise<any> {
    if (!submission) return submission;

    const entityCtx: EntityContext = {
      customer_id: submission.customer_id,
      booking_id: submission.booking_id,
      order_id: submission.booking?.order_id ?? null,
    };

    // Collect all template field IDs
    const templateFieldIds = new Set<number>();
    const collectFields = (sections: any[]) => {
      for (const s of sections || []) {
        for (const item of s.items || []) {
          templateFieldIds.add(item.metadata_field_id);
        }
        collectFields(s.child_sections || []);
      }
    };
    if (submission.template) {
      collectFields(submission.template.sections || []);
      for (const tab of submission.template.tabs || []) {
        collectFields(tab.sections || []);
      }
    }

    // Load metadata values from all relevant entities
    const allValues: any[] = [];
    for (const q of buildEntityQueries(entityCtx)) {
      const vals = await this.metadataValues.getValuesByStoreAndEntity(
        submission.store_id,
        q.entityType,
        q.entityId,
      );
      allValues.push(...vals);
    }

    // Filter to only fields in this template and reshape
    const responses = allValues
      .filter(
        (v: any) =>
          templateFieldIds.size === 0 || templateFieldIds.has(v.field_id),
      )
      .map((v: any) => ({
        id: v.id,
        field_id: v.field_id,
        field: v.field,
        value_text: v.value_text,
        value_number: v.value_number,
        value_date: v.value_date,
        value_bool: v.value_bool,
        value_json: v.value_json,
        created_at: v.created_at,
        updated_at: v.updated_at,
      }));

    return { ...submission, responses };
  }

  async buildPrediagnosisVariables(
    submission: any,
  ): Promise<Record<string, string>> {
    const customerHistory = await this.getCustomerHistory(
      submission.customer_id,
      submission.store_id,
    );

    return {
      service_name: submission.booking?.product?.name ?? 'N/A',
      service_instructions:
        submission.booking?.product?.service_instructions ?? '',
      customer_name: submission.customer
        ? `${submission.customer.first_name} ${submission.customer.last_name}`
        : 'N/A',
      customer_document: submission.customer
        ? `${submission.customer.document_type ?? ''} ${submission.customer.document_number ?? ''}`.trim()
        : 'N/A',
      booking_date: submission.booking?.date
        ? new Date(submission.booking.date).toLocaleDateString('es-CO')
        : 'N/A',
      booking_time: submission.booking?.start_time ?? 'N/A',
      provider_name: submission.booking?.provider?.display_name ?? 'N/A',
      intake_data: this.formatIntakeData(submission.responses ?? []),
      customer_history: customerHistory,
    };
  }

  private formatIntakeData(responses: any[]): string {
    if (!responses || responses.length === 0) return 'Sin datos';
    return responses
      .map((r: any) => {
        const label = r.field?.label ?? `Campo ${r.field_id}`;
        const value =
          r.value_text ??
          r.value_number ??
          r.value_bool ??
          r.value_date ??
          JSON.stringify(r.value_json) ??
          'N/A';
        return `- **${label}:** ${value}`;
      })
      .join('\n');
  }

  private async getCustomerHistory(
    customerId: number | null,
    storeId: number,
  ): Promise<string> {
    if (!customerId) return 'Sin historial previo';

    const previousBookings = await this.prisma
      .withoutScope()
      .bookings.findMany({
        where: {
          customer_id: customerId,
          store_id: storeId,
          status: 'completed',
        },
        include: { product: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 10,
      });

    if (previousBookings.length === 0) return 'Primera visita del paciente';

    const notes = await this.prisma
      .withoutScope()
      .customer_consultation_notes.findMany({
        where: {
          customer_id: customerId,
          store_id: storeId,
          include_in_summary: true,
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      });

    let history = previousBookings
      .map(
        (b: any) =>
          `- ${new Date(b.date).toLocaleDateString('es-CO')}: ${b.product?.name ?? 'Servicio'}`,
      )
      .join('\n');

    if (notes.length > 0) {
      history += '\n\n**Notas relevantes:**\n';
      history += notes
        .map((n: any) => `- [${n.note_key}]: ${n.note_value}`)
        .join('\n');
    }

    return history;
  }
}
