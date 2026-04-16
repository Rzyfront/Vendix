import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EmailTemplateService } from '../../../email/services/email-template.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';

@Controller('store/email-templates')
@UseGuards(PermissionsGuard)
export class EmailTemplatesController {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly emailTemplateService: EmailTemplateService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:settings:read')
  async findAll() {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    // Get store-specific templates
    const storeTemplates = await this.prisma.email_templates.findMany({
      where: { store_id },
      orderBy: { event_type: 'asc' },
    });

    // Get system defaults for reference
    const systemDefaults = await this.prisma
      .withoutScope()
      .email_templates.findMany({
        where: { store_id: null },
        orderBy: { event_type: 'asc' },
      });

    return this.responseService.success({
      store_templates: storeTemplates,
      system_defaults: systemDefaults,
    });
  }

  @Get(':eventType')
  @Permissions('store:settings:read')
  async findByEventType(@Param('eventType') eventType: string) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const template = await this.emailTemplateService.resolve(
      store_id!,
      eventType,
    );
    return this.responseService.success(template);
  }

  @Put(':eventType')
  @Permissions('store:settings:write')
  async upsert(
    @Param('eventType') eventType: string,
    @Body()
    body: {
      subject: string;
      body_html: string;
      body_text?: string;
      variables?: any;
    },
  ) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const existing = await this.prisma.email_templates.findFirst({
      where: { event_type: eventType },
    });

    let result;
    if (existing) {
      result = await this.prisma.email_templates.update({
        where: { id: existing.id },
        data: {
          subject: body.subject,
          body_html: body.body_html,
          body_text: body.body_text,
          variables: body.variables ?? undefined,
          updated_at: new Date(),
        },
      });
    } else {
      result = await this.prisma.email_templates.create({
        data: {
          store_id,
          event_type: eventType,
          subject: body.subject,
          body_html: body.body_html,
          body_text: body.body_text,
          variables: body.variables ?? undefined,
        },
      });
    }

    return this.responseService.success(
      result,
      'Plantilla de email actualizada correctamente',
    );
  }

  @Delete(':eventType')
  @Permissions('store:settings:write')
  async delete(@Param('eventType') eventType: string) {
    const existing = await this.prisma.email_templates.findFirst({
      where: { event_type: eventType },
    });

    if (existing) {
      await this.prisma.email_templates.delete({ where: { id: existing.id } });
    }

    return this.responseService.success(
      null,
      'Plantilla eliminada — se usará el default del sistema',
    );
  }

  @Post(':eventType/preview')
  @Permissions('store:settings:read')
  async preview(
    @Param('eventType') eventType: string,
    @Body()
    body: { subject: string; body_html: string; body_text?: string },
  ) {
    const sampleVariables: Record<string, string> = {
      customer_name: 'María García',
      customer_first_name: 'María',
      service_name: 'Limpieza Facial Premium',
      booking_date: '15 de abril, 2026',
      booking_time: '10:00 AM',
      booking_number: 'BK-001234',
      provider_name: 'Dra. Ana López',
      store_name: 'Centro Estético Bella',
      confirm_url: 'https://example.com/confirm/abc123',
      cancel_url: 'https://example.com/cancel/def456',
      intake_form_url: 'https://example.com/preconsulta/ghi789',
    };

    const rendered = this.emailTemplateService.render(body, sampleVariables);
    return this.responseService.success(rendered);
  }
}
