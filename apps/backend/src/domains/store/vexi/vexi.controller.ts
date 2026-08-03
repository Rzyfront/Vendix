import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { VexiContextService } from './vexi-context.service';
import { ResponseService } from '../../../common/responses/response.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ApplyConfirmationDto } from './dto/apply-confirmation.dto';
import { VexiEnabledGuard } from './guards/vexi-enabled.guard';

/**
 * Vexi's non-realtime surface.
 *
 * Restricted to owner and admin for the same reason as the voice controller:
 * the snapshot carries revenue, plan state and module configuration.
 */
@Controller('store/vexi')
@UseGuards(RolesGuard, VexiEnabledGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class VexiController {
  constructor(
    private readonly context: VexiContextService,
    private readonly responseService: ResponseService,
    private readonly toolRegistry: AIToolRegistry,
  ) {}

  /**
   * The exact variable map that gets interpolated into Vexi's system prompt.
   *
   * Exposed as an endpoint so the prompt's inputs are inspectable without
   * reading provider logs: when Vexi says something wrong about the business,
   * this tells you whether the prompt or the model is at fault.
   */
  @Get('context')
  async getContext() {
    const snapshot = await this.context.buildSnapshot();
    return this.responseService.success(snapshot, 'Vexi context snapshot');
  }

  /**
   * Applies a write the user approved in the confirmation card.
   *
   * Nothing about authorization is delegated to the token: `executeTool()`
   * still checks the caller's permissions on the way through, and the write
   * tool still re-verifies its own preconditions. The token only proves *this
   * user saw this exact diff*, and it is consumed atomically, so a
   * double-clicked "Aprobar" applies once.
   */
  @Post('confirmations/apply')
  async applyConfirmation(@Body() dto: ApplyConfirmationDto) {
    const output = await this.toolRegistry.executeTool(
      dto.tool,
      dto.arguments as Record<string, any>,
      { confirmationToken: dto.confirmation_token },
    );

    return this.responseService.success(
      { tool: dto.tool, output },
      'Cambio aplicado',
    );
  }
}
