# Sandbox de análisis en Python sobre AWS Lambda aislada (F9 · D3)

**Estado: implementación lista en código/IaC, APAGADA por defecto y NO desplegada. T53 (certificación de aislamiento sobre la Lambda real) está PENDIENTE.**

Nunca se crea ni despliega infraestructura AWS desde el entorno de desarrollo ni desde esta rama. El backend y sus workers **nunca** ejecutan código generado por IA en el host: el worker solo orquesta la cola, materializa tablas de la misma conversación, invoca la Lambda con `lambda:InvokeFunction`, valida el JSON de salida y persiste bloques (`table`, `chart`, `kpi`).

---

## Arquitectura (Decisión D3)

```text
NestJS (API / worker ai-agent) — autoridad vigente, plan, admisión y auditoría cifrada
   │  RequestResponse JSON (protocolo vendix.analysis/v1, nonce 64 hex, sin secretos)
   │  política IAM mínima: backend-invoke-policy.json (solo lambda:InvokeFunction a 1 ARN)
   ▼
AWS Lambda (imagen contenedor Python 3.12 · Dockerfile + template.json)
   ├── VPC dedicada con subredes privadas únicamente (sin IGW, sin NAT, sin VPC endpoints)
   ├── Security group sin ingress y sin egress real (regla loopback reemplaza allow-all)
   ├── Rol IAM limitado exclusivamente a gestión de ENI para adjuntar la Lambda a la VPC
   ├── Código en LAMBDA_TASK_ROOT de solo lectura (chmod a-w); solo /tmp escribible
   └── Por cada invocación (handler.py → runner.py):
          1. Valida petición y recorta límites contra HARD_LIMITS.
          2. Limpia /tmp antes y después de ejecutar.
          3. Marca al proceso padre no-dumpable en Linux (`prctl(PR_SET_DUMPABLE, 0)`) para impedir lectura de `/proc/<ppid>/environ` o `ptrace` desde el hijo, y lanza un proceso hijo nuevo (`python -I runner.py`) en sesión propia con entorno limpio (sin `AWS_*`), `RLIMIT_AS` / `RLIMIT_CPU` / `RLIMIT_NPROC` / `RLIMIT_FSIZE` / `RLIMIT_CORE` y timeout de pared.
          4. Mata todo el grupo de procesos (`SIGKILL`) al terminar o vencer el tiempo.
          5. Lee `result.json` con `O_NOFOLLOW`, revalida `result` (tables/series/figures/notes) y devuelve solo JSON acotado.
```

---

## Interruptor apagado por defecto

`SandboxLambdaClientService.configuration()` devuelve `null` (feature apagada; Vex responde que el análisis avanzado no está disponible y usa `compute`) salvo que **todas** estas variables estén configuradas y sean consistentes:

| Variable | Requisito |
| --- | --- |
| `AI_ANALYSIS_SANDBOX_ENABLED` | Exactamente `'true'` |
| `AI_ANALYSIS_LAMBDA_FUNCTION_ARN` | ARN concreto de una función Lambda (sin comodines) |
| `AI_ANALYSIS_LAMBDA_REGION` | Región AWS válida que coincide con la del ARN |
| `AI_ANALYSIS_RUNTIME_DIGEST` | `sha256:<64 hex>` inyectado en la imagen construida |
| `AI_ANALYSIS_CERTIFIED_DIGEST` | `sha256:<64 hex>` **idéntico** a `AI_ANALYSIS_RUNTIME_DIGEST`, fijado solo tras completar T53 |

Además, el backend requiere `SandboxAuditRepository.sourceAvailable()` (cifrado de fuente en `ai_agent_script_runs`), el SDK opcional `@aws-sdk/client-lambda` instalado en runtime y la capacidad de plan `vex.code_analysis` activa para la tienda.

---

## Pruebas offline (sin AWS ni ejecución hostil en Mac)

```bash
node --test infra/agent-sandbox/python/template.test.cjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
  infra/agent-sandbox/python/test_runner.py \
  infra/agent-sandbox/python/test_handler.py -v
```

Las pruebas de `handler.py` mockean `subprocess.Popen` y validan limpieza de `/tmp`, variables de entorno del hijo, códigos de error, truncado de mensajes y validación estricta. Estas pruebas **no** certifican el aislamiento real de AWS.

---

## Compuertas pendientes de T53 (certificación de aislamiento)

Antes de encender `AI_ANALYSIS_SANDBOX_ENABLED=true` en cualquier entorno real, un operador con credenciales de QA debe construir la imagen (`pip-compile --generate-hashes` + `FROM ...@sha256:<digest>`), desplegar `template.json` en una cuenta/región QA y producir un informe firmado de certificación que enlace el `runtime_digest` final con la evidencia real de:

1. **Egreso cero**: intentos de DNS, HTTP/HTTPS, sockets TCP/UDP crudos, enlace al metadata service (`169.254.169.254`) y conexiones hacia la VPC de producción fallan con bloqueo total.
2. **Sistema de archivos, `/proc` y secretos**: intento de escritura fuera de `/tmp` falla (`Read-only file system`); symlink en `/tmp/result.json` rechazado (`O_NOFOLLOW`); entorno del hijo sin `AWS_*` ni credenciales; lectura de `/proc/<ppid>/environ`, `/proc/<ppid>/mem` y `ptrace` sobre el padre fallan (`PermissionError` gracias a `PR_SET_DUMPABLE=0`); ningún secreto presente en proceso ni en logs.
3. **Límites de recursos**: bomba de memoria (`ANALYSIS_MEMORY`), ciclo infinito de CPU (`ANALYSIS_TIMEOUT`), fork bomb (`RLIMIT_NPROC`), inundación de stdout/stderr y archivo grande en `/tmp` (`RLIMIT_FSIZE`) terminan dentro del presupuesto sin dejar procesos huérfanos.
4. **Aislamiento multi-tenant (100 ejecuciones alternando 3 tiendas)**: ejecución de 100 invocaciones consecutivas alternando datos marcados de 3 tiendas distintas (reutilizando el mismo entorno caliente de Lambda) con verificación de cero residuos en `/tmp`, memoria, variables globales o respuestas cruzadas.
5. **Revisión de política IAM**: verificación en AWS de que el rol de ejecución de la Lambda solo tiene permisos ENI y el rol del backend solo tiene `lambda:InvokeFunction` sobre ese único ARN.
6. **Firma y fijación de digest**: registrar el `runtime_digest` verificado en el informe firmado y fijar `AI_ANALYSIS_CERTIFIED_DIGEST` a ese valor exacto. Cualquier cambio de imagen, dependencias o plantilla invalida la certificación y exige re-certificar.
