import { ApiPropertyOptional } from '@nestjs/swagger';
import { ItemNotes } from '@common/decorators/item-notes.decorator';

/**
 * Edita la nota de un ítem de cualquier orden. `null` (o `''`) la borra.
 */
export class UpdateOrderItemNotesDto {
  @ApiPropertyOptional({
    description: 'Nota del ítem (max 200). null o vacío la borra.',
    nullable: true,
  })
  @ItemNotes()
  notes?: string | null;
}
