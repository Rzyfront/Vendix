import { PartialType } from '@nestjs/mapped-types';
import { CreateDispatchNoteDto } from './create-dispatch-note.dto';

export class UpdateDispatchNoteDto extends PartialType(CreateDispatchNoteDto) {}
