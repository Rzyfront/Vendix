-- Recordatorios y notificaciones F1 (odd/tasks/recordatorios-notificaciones.md
-- §3.1b) — backfill de `scheduled_reminders` para las tareas CRM que ya
-- existían antes del motor: solo tareas `pending` con fecha FUTURA. Replica lo
-- que haría `ReminderScheduler.sync` al crear cada tarea hoy:
--   - `due_soon` en due_at - notifications.task_due_soon_minutes (60 por
--     defecto, rango 5-1440), solo si ese instante aún no pasó;
--   - `due` en due_at;
--   - `overdue_escalation` en due_at + 24 h, solo si el creador existe y no es
--     el responsable;
--   - `digest`: una fila por tienda y día local (zona de la tienda), a la hora
--     notifications.daily_digest_hour (7 por defecto, rango 0-23), si no pasó.
-- Las tareas vencidas o sin fecha no reciben nada: nunca hay avalancha.
--
-- DATA IMPACT:
--   Tables affected: scheduled_reminders (solo INSERT). crm_tasks, stores y
--     store_settings solo se leen.
--   Expected row changes: hasta 3 filas por tarea pendiente con fecha futura,
--     más 1 por tienda y día con tareas. 0 si no hay tareas así.
--   Destructive operations: none. Sin UPDATE, DELETE, DROP ni TRUNCATE.
--   FK/cascade risk: store_id -> stores (RESTRICT); se toma de la propia tarea.
--   Idempotency: ON CONFLICT (source_type, source_id, kind, fire_at) DO
--     NOTHING. Correrla dos veces, o después de que la app ya programó la
--     tarea, no duplica ni re-arma nada.
--   Approval: backfill pedido en el encargo F1 aprobado por Rafael (2026-11-23).
-- Skill: vendix-prisma-migrations.
--
-- `due_at` y `fire_at` son TIMESTAMP sin zona que guardan UTC.

WITH store_cfg AS (
  SELECT
    s.id AS store_id,
    COALESCE(
      (SELECT tz.name FROM pg_timezone_names tz WHERE tz.name = s.timezone LIMIT 1),
      (SELECT tz.name FROM pg_timezone_names tz
        WHERE tz.name = ss.settings -> 'general' ->> 'timezone' LIMIT 1),
      'America/Bogota'
    ) AS timezone,
    CASE
      WHEN jsonb_typeof(ss.settings -> 'notifications' -> 'task_due_soon_minutes') = 'number'
        AND (ss.settings -> 'notifications' ->> 'task_due_soon_minutes') ~ '^[0-9]+$'
        AND (ss.settings -> 'notifications' ->> 'task_due_soon_minutes')::int BETWEEN 5 AND 1440
      THEN (ss.settings -> 'notifications' ->> 'task_due_soon_minutes')::int
      ELSE 60
    END AS due_soon_minutes,
    CASE
      WHEN jsonb_typeof(ss.settings -> 'notifications' -> 'daily_digest_hour') = 'number'
        AND (ss.settings -> 'notifications' ->> 'daily_digest_hour') ~ '^[0-9]+$'
        AND (ss.settings -> 'notifications' ->> 'daily_digest_hour')::int BETWEEN 0 AND 23
      THEN (ss.settings -> 'notifications' ->> 'daily_digest_hour')::int
      ELSE 7
    END AS digest_hour
  FROM stores s
  LEFT JOIN store_settings ss ON ss.store_id = s.id
),
tasks AS (
  SELECT
    t.id,
    t.store_id,
    t.due_at,
    t.assigned_user_id,
    t.created_by_user_id,
    cfg.timezone,
    cfg.due_soon_minutes,
    cfg.digest_hour
  FROM crm_tasks t
  JOIN store_cfg cfg ON cfg.store_id = t.store_id
  WHERE t.status = 'pending'
    AND t.due_at IS NOT NULL
    AND t.due_at > (now() AT TIME ZONE 'UTC')
),
planned AS (
  -- Por vencer
  SELECT store_id, 'crm_task'::varchar AS source_type, id AS source_id,
         'due_soon'::varchar AS kind,
         due_at - make_interval(mins => due_soon_minutes) AS fire_at
  FROM tasks
  WHERE due_at - make_interval(mins => due_soon_minutes) > (now() AT TIME ZONE 'UTC')
  UNION ALL
  -- Vencida
  SELECT store_id, 'crm_task', id, 'due', due_at
  FROM tasks
  UNION ALL
  -- Sigue vencida 24 h: al creador, si no es el responsable
  SELECT store_id, 'crm_task', id, 'overdue_escalation', due_at + interval '24 hours'
  FROM tasks
  WHERE created_by_user_id IS NOT NULL
    AND assigned_user_id IS NOT NULL
    AND created_by_user_id <> assigned_user_id
  UNION ALL
  -- Resumen de la mañana: una fila por tienda y día local de vencimiento
  SELECT DISTINCT store_id, 'crm_task_digest', store_id, 'digest',
         ((((due_at AT TIME ZONE 'UTC') AT TIME ZONE timezone)::date
            + make_interval(hours => digest_hour))
           AT TIME ZONE timezone) AT TIME ZONE 'UTC'
  FROM tasks
)
INSERT INTO scheduled_reminders (store_id, source_type, source_id, kind, fire_at)
SELECT store_id, source_type, source_id, kind, fire_at
FROM planned
WHERE fire_at > (now() AT TIME ZONE 'UTC')
ON CONFLICT (source_type, source_id, kind, fire_at) DO NOTHING;
