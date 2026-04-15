import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Resolve template: store-specific > system default > null (fallback to legacy)
   */
  async resolve(storeId: number, eventType: string) {
    // Try store-specific template first
    const storeTemplate = await this.prisma.email_templates.findFirst({
      where: { store_id: storeId, event_type: eventType, is_active: true },
    });
    if (storeTemplate) return storeTemplate;

    // Fallback to system default (store_id = null)
    const systemDefault = await this.prisma.email_templates.findFirst({
      where: { store_id: null, event_type: eventType, is_active: true },
    });

    return systemDefault;
  }

  /**
   * Render template by interpolating {{variable}} placeholders
   */
  render(
    template: { subject: string; body_html: string; body_text?: string | null },
    variables: Record<string, string>,
  ) {
    const interpolate = (text: string) => {
      return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '');
    };

    return {
      subject: interpolate(template.subject),
      body_html: interpolate(template.body_html),
      body_text: template.body_text
        ? interpolate(template.body_text)
        : undefined,
    };
  }

  /**
   * Resolve and render in one step
   */
  async resolveAndRender(
    storeId: number,
    eventType: string,
    variables: Record<string, string>,
  ) {
    const template = await this.resolve(storeId, eventType);
    if (!template) return null;
    return this.render(template, variables);
  }
}
