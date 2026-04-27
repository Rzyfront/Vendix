import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PartnersService } from '../services/partners.service';
import { ResponseService } from '../../../../common/responses/response.service';
import {
  TogglePartnerDto,
  SetMarginCapDto,
  CreatePartnerOverrideDto,
  UpdatePartnerOverrideDto,
  PartnerQueryDto,
  UpdatePartnerOrganizationDto,
} from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Partners')
@Controller('superadmin/subscriptions/partners')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PartnersController {
  constructor(
    private readonly partnersService: PartnersService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:partners:read')
  @Get()
  @ApiOperation({ summary: 'List all partner organizations' })
  async findAll(@Query() query: PartnerQueryDto) {
    const result = await this.partnersService.findAllPartners(query);
    return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Partners retrieved');
  }

  @Permissions('superadmin:subscriptions:partners:read')
  @Get(':organizationId')
  @ApiOperation({ summary: 'Get partner organization details' })
  async findOne(@Param('organizationId', ParseIntPipe) organizationId: number) {
    const result = await this.partnersService.findPartner(organizationId);
    return this.responseService.success(result, 'Partner retrieved');
  }

  @Permissions('superadmin:subscriptions:partners:update')
  @Patch('toggle')
  @ApiOperation({ summary: 'Toggle partner status for an organization' })
  async toggle(@Body() dto: TogglePartnerDto) {
    const result = await this.partnersService.togglePartner(dto);
    return this.responseService.updated(result, 'Partner status updated');
  }

  @Permissions('superadmin:subscriptions:partners:update')
  @Patch('margin-cap')
  @ApiOperation({ summary: 'Set max partner margin cap for an organization' })
  async setMarginCap(@Body() dto: SetMarginCapDto) {
    const result = await this.partnersService.setMarginCap(dto);
    return this.responseService.updated(result, 'Partner margin cap updated');
  }

  @Permissions('superadmin:subscriptions:partners:update')
  @Patch(':organizationId')
  @ApiOperation({ summary: 'Update partner organization settings' })
  async updatePartner(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Body() dto: UpdatePartnerOrganizationDto,
  ) {
    const result = await this.partnersService.updatePartnerOrganization(
      organizationId,
      dto,
    );
    return this.responseService.updated(result, 'Partner updated');
  }

  @Permissions('superadmin:subscriptions:partners:update')
  @Post('overrides')
  @ApiOperation({ summary: 'Create a partner plan override' })
  async createOverride(@Body() dto: CreatePartnerOverrideDto) {
    const result = await this.partnersService.createOverride(dto);
    return this.responseService.created(result, 'Partner override created');
  }

  @Permissions('superadmin:subscriptions:partners:update')
  @Patch('overrides/:id')
  @ApiOperation({ summary: 'Update a partner plan override' })
  async updateOverride(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePartnerOverrideDto) {
    const result = await this.partnersService.updateOverride(id, dto);
    return this.responseService.updated(result, 'Partner override updated');
  }

  @Permissions('superadmin:subscriptions:partners:update')
  @Delete('overrides/:id')
  @ApiOperation({ summary: 'Delete a partner plan override' })
  async removeOverride(@Param('id', ParseIntPipe) id: number) {
    await this.partnersService.removeOverride(id);
    return this.responseService.deleted('Partner override deleted');
  }
}
