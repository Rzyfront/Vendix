import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ResponseService } from '../../../common/responses/response.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { RolesGuard } from '../../auth/guards/roles.guard';
import {
  CODEMODE_RUNS_MAX_LIMIT,
  CodeModeRunsService,
} from './codemode-runs.service';

export class CodeModeRunsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CODEMODE_RUNS_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @IsString()
  outcome?: string;
}

/** Same guard and role as the sibling controllers: super admin only. Never exposes source. */
@ApiTags('Admin AI Code Mode runs')
@Controller('superadmin/ai-engine/codemode-runs')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class CodeModeRunsController {
  constructor(
    private readonly runs: CodeModeRunsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List Code Mode runs (metadata only)' })
  async list(@Query() query: CodeModeRunsQueryDto) {
    const page = await this.runs.list(query);
    return this.responseService.paginated(
      page.items,
      page.total,
      page.page,
      page.limit,
      'Ejecuciones de Code Mode',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'One Code Mode run: calls, rounds, duration, result' })
  async detail(@Param('id') id: string) {
    return this.responseService.success(
      await this.runs.get(id),
      'Detalle de la ejecución',
    );
  }
}
