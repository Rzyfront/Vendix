model organization_payment_policies {
  id              Int           @id @default(autoincrement())
  organization_id Int           @unique
  
  # Configuración de métodos permitidos
  allowed_methods String[]      # IDs de system_payment_methods permitidos para la organización
  
  # Configuración base para nuevas tiendas
  default_config  Json?         # Configuración base que heredan las tiendas
  
  # Políticas organizacionales
  enforce_policies Boolean      @default(false) # Si se aplican las políticas a todas las tiendas
  allow_store_overrides Boolean @default(true)  # Si las tiendas pueden modificar configuraciones
  
  # Configuraciones globales
  min_order_amount Decimal?     @db.Decimal(12, 2) # Monto mínimo global para pedidos
  max_order_amount Decimal?     @db.Decimal(12, 2) # Monto máximo global para pedidos
  
  # Auditoría
  created_at      DateTime?     @default(now()) @db.Timestamp(6)
  updated_at      DateTime?     @default(now()) @db.Timestamp(6)
  
  # Relaciones
  organization    organizations @relation(fields: [organization_id], references: [id], onDelete: Cascade)
  
  @@index([organization_id])
}