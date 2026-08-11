-- Migration: backfill the `realtime_voice` AI feature flag into plans that
-- predate it
--
-- ⚠️ REQUIERE APROBACIÓN EXPLÍCITA ANTES DE APLICAR ⚠️
-- Esta migración MUTA filas existentes de `subscription_plans`, una tabla que
-- gobierna entitlement y facturación. No se aplica sin el sí del responsable.
--
-- DATA IMPACT:
--   Tabla mutada:  subscription_plans (UPDATE de ai_feature_flags)
--   Sentencia:     UPDATE ... WHERE NOT (ai_feature_flags ? 'realtime_voice')
--   Filas:         una por plan que hoy carece de la clave. En dev son 5
--                  (trial-default, starter, pro, enterprise, dev-annual); en
--                  producción, las que no se hayan editado desde el panel.
--                  Verificar antes y después con
--                    SELECT id, code, ai_feature_flags ? 'realtime_voice'
--                    FROM subscription_plans ORDER BY id;
--   Destructivo:   NO. Es puramente aditivo: `||` sobre jsonb agrega la clave y
--                  el WHERE excluye toda fila que ya la tenga, así que ninguna
--                  configuración elegida por un operador se sobrescribe.
--   Otras claves:  intactas. `||` fusiona al nivel superior del objeto y solo
--                  se pasa `realtime_voice`, así que text_generation,
--                  streaming_chat, conversations, tool_agents, rag_embeddings y
--                  async_queue se conservan tal cual.
--   FK/cascade:    ninguna. No se toca ninguna clave ni relación.
--   Reversible:    SÍ —
--                    UPDATE subscription_plans
--                    SET ai_feature_flags = ai_feature_flags - 'realtime_voice';
--                  (aplicar solo a los planes que esta migración tocó).
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE, sin UPDATE sin WHERE.
--
-- Por qué existe:
--   `subscription-plans.seed.ts` y `subscription-plans-production.seed.ts` ya
--   declaran `realtime_voice`, pero los seeds de planes preservan la
--   configuración del operador y por lo tanto NO reconcilian filas existentes.
--   El resultado es que ninguna instalación anterior a esa edición del seed
--   tiene la clave, y `AiAccessGuard` trata una clave ausente como función
--   deshabilitada. Consecuencia observable: el modo voz —tanto el realtime
--   speech-to-speech como el pipeline nuevo— responde 402 en toda instalación
--   existente, incluida dev. La función es literalmente inalcanzable sin este
--   backfill, que es también la razón por la que el fallo pasó desapercibido:
--   nadie llegó nunca a la primera llamada al proveedor.
--
-- Valores por plan:
--   Copiados de los seeds, no inventados, para que el backfill y una
--   instalación nueva queden idénticos. `degradation: 'block'` en todos porque
--   el audio es la superficie de IA más cara por unidad y tiene que frenar en
--   seco al llegar al tope, no degradar con aviso.
--
--   trial-default  habilitado,  7200 s  (2 h — acceso completo durante la prueba)
--   starter        deshabilitado,  0 s   (el tier no incluye voz)
--   pro            habilitado,  1800 s  (30 min)
--   enterprise     habilitado, 36000 s  (10 h — finito a propósito donde el
--                  resto del tier es ilimitado: la voz factura por minuto de
--                  sesión abierta y un asiento sin techo no tiene tope de gasto)
--   dev-annual     habilitado,  7200 s  (plan solo de desarrollo; necesita
--                  margen para probar la superficie)
--   cualquier otro deshabilitado,  0 s   (preserva EXACTAMENTE el comportamiento
--                  de hoy: una clave ausente ya se evalúa como deshabilitada,
--                  así que un plan desconocido no cambia de conducta)

UPDATE "subscription_plans"
SET "ai_feature_flags" = "ai_feature_flags" || jsonb_build_object(
      'realtime_voice',
      jsonb_build_object(
        'enabled',
        CASE "code"
          WHEN 'trial-default' THEN true
          WHEN 'pro' THEN true
          WHEN 'enterprise' THEN true
          WHEN 'dev-annual' THEN true
          ELSE false
        END,
        'monthly_voice_seconds_cap',
        CASE "code"
          WHEN 'trial-default' THEN 7200
          WHEN 'pro' THEN 1800
          WHEN 'enterprise' THEN 36000
          WHEN 'dev-annual' THEN 7200
          ELSE 0
        END,
        'degradation',
        'block'
      )
    ),
    "updated_at" = NOW()
WHERE NOT ("ai_feature_flags" ? 'realtime_voice');
