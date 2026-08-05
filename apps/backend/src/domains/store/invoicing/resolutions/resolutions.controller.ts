import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ResolutionsService } from './resolutions.service';
import { ResolutionScannerService } from './resolution-scanner.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateResolutionDto } from './dto/create-resolution.dto';
import { UpdateResolutionDto } from './dto/update-resolution.dto';

/** Accepted by the scanner; anything else is rejected before touching the AI. */
const SCAN_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

@Controller('store/invoicing/resolutions')
export class ResolutionsController {
  constructor(
    private readonly resolutions_service: ResolutionsService,
    private readonly response_service: ResponseService,
    private readonly resolution_scanner_service: ResolutionScannerService,
  ) {}

  @Get()
  @Permissions('invoicing:read')
  async findAll() {
    const result = await this.resolutions_service.findAll();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('invoicing:read')
  async findOne(@Param('id') id: string) {
    const result = await this.resolutions_service.findOne(+id);
    return this.response_service.success(result);
  }

  /**
   * Reads a DIAN resolution document and answers the extracted fields. Writes
   * nothing: the user reviews the result and then calls `POST /` or
   * `PATCH /:id` explicitly, so a mis-read never lands in the numbering table.
   */
  @Post('scan')
  @Permissions('invoicing:write')
  @UseInterceptors(FileInterceptor('file'))
  async scan(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.RESOLUTION_SCAN_NO_FILE);
    }
    if (!SCAN_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new VendixHttpException(ErrorCodes.RESOLUTION_SCAN_INVALID_FILE);
    }

    const result =
      await this.resolution_scanner_service.scanResolutionDocument(file);
    return this.response_service.success(
      result,
      'Resolución escaneada exitosamente',
    );
  }

  @Post()
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateResolutionDto) {
    const result = await this.resolutions_service.create(create_dto);
    return this.response_service.success(
      result,
      'Resolution created successfully',
    );
  }

  @Patch(':id')
  @Permissions('invoicing:write')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateResolutionDto,
  ) {
    const result = await this.resolutions_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Resolution updated successfully',
    );
  }

  @Delete(':id')
  @Permissions('invoicing:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.resolutions_service.remove(+id);
    return this.response_service.success(
      null,
      'Resolution deleted successfully',
    );
  }
}
