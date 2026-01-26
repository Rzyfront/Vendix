import { PartialType } from '@nestjs/mapped-types';
import { CreateSystemDocumentDto } from './create-system-document.dto';

export class UpdateSystemDocumentDto extends PartialType(CreateSystemDocumentDto) {
  // Los campos son opcionales para actualización parcial
  // is_active se maneja en el endpoint específico de activar/desactivar
}
