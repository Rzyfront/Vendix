import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';

export class CreateSnapshotDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9-]+$/, {
    message: 'Name can only contain letters, numbers, and hyphens',
  })
  name: string;
}
