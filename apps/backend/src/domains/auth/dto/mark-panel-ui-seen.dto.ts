import { IsString, IsNotEmpty, IsIn, MaxLength } from 'class-validator';

/**
 * DTO para el endpoint `POST /auth/panel-ui/mark-seen`.
 *
 * Permite al usuario marcar un módulo del sidebar como "ya visto",
 * removiéndolo del badge "Nuevo" de forma persistente.
 */
export class MarkPanelUiSeenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  key: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([
    'STORE_ADMIN',
    'ORG_ADMIN',
    'STORE_ECOMMERCE',
    'VENDIX_LANDING',
    'VENDIX_ADMIN',
  ])
  app_type: string;
}
