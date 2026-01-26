import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Delete,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import {
  CreateAdjustmentDto,
  AdjustmentQueryDto,
} from './interfaces/inventory-adjustment.interface';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@ApiTags('Inventory Adjustments')
@Controller('store/inventory/adjustments')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class InventoryAdjustmentsController {
  constructor(
    private readonly adjustmentsService: InventoryAdjustmentsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create inventory adjustment' })
  @ApiResponse({ status: 201, description: 'Adjustment created successfully' })
  @RequirePermissions('store:inventory:adjustments:create')
  async createAdjustment(@Body() createAdjustmentDto: CreateAdjustmentDto) {
    const result =
      await this.adjustmentsService.createAdjustment(createAdjustmentDto);
    return this.responseService.success(
      result,
      'Adjustment created successfully',
    );
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve inventory adjustment' })
  @ApiResponse({ status: 200, description: 'Adjustment approved successfully' })
  @RequirePermissions('store:inventory:adjustments:approve')
  async approveAdjustment(
    @Param('id') id: number,
    @Body('approvedByUserId') approvedByUserId: number,
  ) {
    const result = await this.adjustmentsService.approveAdjustment(
      parseInt(id.toString()),
      approvedByUserId,
    );
    return this.responseService.success(
      result,
      'Adjustment approved successfully',
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get inventory adjustments with filters' })
  @ApiResponse({
    status: 200,
    description: 'Adjustments retrieved successfully',
  })
  @RequirePermissions('store:inventory:adjustments:read')
  async getAdjustments(@Query() query: AdjustmentQueryDto) {
    const result = await this.adjustmentsService.getAdjustments(query);
    return this.responseService.success(result);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get adjustment by ID' })
  @ApiResponse({
    status: 200,
    description: 'Adjustment retrieved successfully',
  })
  @RequirePermissions('store:inventory:adjustments:read')
  async getAdjustmentById(@Param('id') id: number) {
    const result = await this.adjustmentsService.getAdjustmentById(
      parseInt(id.toString()),
    );
    return this.responseService.success(result);
  }

  @Get('summary/:organizationId')
  @ApiOperation({ summary: 'Get adjustment summary for organization' })
  @ApiResponse({
    status: 200,
    description: 'Adjustment summary retrieved successfully',
  })
  @RequirePermissions('store:inventory:adjustments:read')
  async getAdjustmentSummary(
    @Param('organizationId') organizationId: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.adjustmentsService.getAdjustmentSummary(
      parseInt(organizationId.toString()),
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
    return this.responseService.success(result);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete pending adjustment' })
  @ApiResponse({ status: 200, description: 'Adjustment deleted successfully' })
  @RequirePermissions('store:inventory:adjustments:delete')
  async deleteAdjustment(@Param('id') id: number) {
    await this.adjustmentsService.deleteAdjustment(parseInt(id.toString()));
    return this.responseService.success(
      null,
      'Adjustment deleted successfully',
    );
  }
}
