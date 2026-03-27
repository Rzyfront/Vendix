import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

@Injectable()
export class McpPromptProvider {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async listPrompts(): Promise<McpPromptDefinition[]> {
    const apps = await this.prisma.ai_engine_applications.findMany({
      where: { is_active: true },
      select: {
        key: true,
        name: true,
        description: true,
        prompt_template: true,
      },
    });

    return apps.map((app) => {
      const variables =
        app.prompt_template
          ?.match(/\{\{(\w+)\}\}/g)
          ?.map((v) => v.replace(/\{\{|\}\}/g, '')) || [];

      return {
        name: app.key,
        description: app.description || app.name,
        arguments: variables.map((v) => ({
          name: v,
          description: `Value for ${v}`,
          required: true,
        })),
      };
    });
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<{ messages: McpPromptMessage[] }> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: name },
    });

    if (!app) {
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Prompt "${name}" not found` },
          },
        ],
      };
    }

    let promptText = app.prompt_template || '';

    if (args) {
      promptText = promptText.replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => args[key] ?? `{{${key}}}`,
      );
    }

    const messages: McpPromptMessage[] = [];

    // MCP prompt spec only supports 'user' and 'assistant' roles (no 'system').
    // Prepend the system prompt as context to the user message.
    let fullPrompt = promptText;
    if (app.system_prompt) {
      fullPrompt = `Context: ${app.system_prompt}\n\n${promptText}`;
    }

    messages.push({
      role: 'user',
      content: { type: 'text', text: fullPrompt },
    });

    return { messages };
  }
}
