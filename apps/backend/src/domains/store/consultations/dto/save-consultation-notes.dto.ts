import { IsArray, ValidateNested, IsString, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class ConsultationNoteDto {
  @IsString()
  note_key: string;

  @IsString()
  note_value: string;

  @IsOptional()
  @IsBoolean()
  include_in_summary?: boolean;
}

export class SaveConsultationNotesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsultationNoteDto)
  notes: ConsultationNoteDto[];
}
