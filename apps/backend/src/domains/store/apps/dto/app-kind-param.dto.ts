import { IsIn } from 'class-validator';
import { APP_KINDS, AppKind } from '../apps.catalog';

/** Path param of GET /store/apps/:kind. */
export class AppKindParamDto {
  @IsIn(APP_KINDS)
  kind!: AppKind;
}
