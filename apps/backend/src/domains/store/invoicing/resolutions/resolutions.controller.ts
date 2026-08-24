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
  ParseIntPipe,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ResolutionsService } from './resolutions.service';
import { ResolutionScannerService } from './resolution-scanner.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { CreateResolutionDto } from './dto/create-resolution.dto';
import { UpdateResolutionDto } from './dto/update-resolution.dto';

/** Accepted by the scanner; anything else is rejected before touching the AI. */
const SCAN_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

/*
 * NOTA sobre el guard: hasta este cambio la clase no declaraba `PermissionsGuard`,
 * así que los `@Permissions` de abajo eran decoración inerte —Nest sólo los lee si
 * hay un guard que los consulte—. Verificado empíricamente: un usuario de rol
 * `cashier` sin un solo permiso `invoicing:*` obtenía 200 en las lecturas y
 * alcanzaba la capa de servicio en los `DELETE` (404 con `error_code` de dominio,
 * prueba de que la autorización no se evaluaba). No es un permiso nuevo ni una
 * restricción nueva: es hacer efectiva la que el archivo ya declaraba. Mismo
 * criterio que `pos/pos-fiscal.controller.ts`.
 */
@Controller('store/invoicing/resolutions')
@UseGuards(PermissionsGuard)
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

  /**
   * `ParseIntPipe` en todos los `:id` de este controlador, como en
   * `DianConfigController`: sin él, `+id` sobre un identificador no numérico
   * producía `NaN` y Prisma lo rechazaba contra la columna `Int` con un 500,
   * cuando lo correcto es un 400 — la petición está mal formada, el servidor no
   * falló. Con un id numérico inexistente la respuesta ya era el 404 esperado.
   *
   * `POST scan` no queda atrapado por el pipe aunque se declare más abajo: es
   * otro verbo, y este `:id` solo captura GET.
   */
  @Get(':id')
  @Permissions('invoicing:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.resolutions_service.findOne(id);
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
    @Param('id', ParseIntPipe) id: number,
    @Body() update_dto: UpdateResolutionDto,
  ) {
    const result = await this.resolutions_service.update(id, update_dto);
    return this.response_service.success(
      result,
      'Resolution updated successfully',
    );
  }

  @Delete(':id')
  @Permissions('invoicing:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.resolutions_service.remove(id);
    return this.response_service.success(
      null,
      'Resolution deleted successfully',
    );
  }
}
