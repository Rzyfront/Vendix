import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { McpController } from './mcp.controller';
import { McpAuthService } from './mcp-auth.service';
import { McpAuditService } from './mcp-audit.service';
import { McpAuthGuard } from './guards/mcp-auth.guard';
import { McpResourceProvider } from './providers/mcp-resource.provider';
import { McpToolProvider } from './providers/mcp-tool.provider';
import { McpPromptProvider } from './providers/mcp-prompt.provider';

@Module({
  imports: [PrismaModule],
  controllers: [McpController],
  providers: [
    McpAuthService,
    McpAuditService,
    McpAuthGuard,
    McpResourceProvider,
    McpToolProvider,
    McpPromptProvider,
  ],
})
export class McpModule {}
