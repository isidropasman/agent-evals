# Operación de Gauntlet en producción

## Arquitectura de producción

El código y el esquema están preparados para este despliegue. En este workspace Neon está provisionado; Inngest todavía requiere crear la cuenta/app en Inngest Cloud, cargar sus credenciales y sincronizar el endpoint público antes de declarar readiness de producción. El Marketplace de Vercel es opcional.

- Vercel ejecuta Next.js en runtime Node/Fluid Compute.
- Neon Postgres es la fuente compartida; `DATABASE_URL` es la URL que usa la aplicación y `DATABASE_URL_UNPOOLED` queda reservada para `pg_dump`/`pg_restore` operativos.
- Inngest recibe `gauntlet/gate.requested` y ejecuta gates con retries, backoff, concurrencia limitada e idempotencia por `gateRunId` una vez completado su provisioning.
- La cancelación de runs se persiste en Postgres; el abort local acelera la respuesta cuando existe, pero el runner también consulta la señal compartida para funcionar entre instancias.
- El dashboard se protege con `GAUNTLET_DASHBOARD_USER/PASSWORD`; integraciones usan API keys con RBAC.

## Variables obligatorias

| Variable | Uso | Exposición |
| --- | --- | --- |
| `DATABASE_URL` | Postgres pooled | sólo server |
| `DATABASE_URL_UNPOOLED` | backup/restore con `pg_dump`/`pg_restore` | sólo operator |
| `GAUNTLET_SECRETS_KEY` | AES-256-GCM de credenciales almacenadas | sólo server |
| `INNGEST_EVENT_KEY` | publicación de jobs | sólo server |
| `INNGEST_SIGNING_KEY` | verificación del endpoint worker | sólo server |
| `INNGEST_SIGNING_KEY_FALLBACK` | rotación sin downtime | sólo server, temporal |
| `GAUNTLET_DASHBOARD_USER/PASSWORD` | Basic Auth del dashboard | sólo server |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | providers del evaluador | sólo server/CI |

Nunca uses `NEXT_PUBLIC_` para una de estas variables. Vercel Marketplace o la configuración manual mantienen los recursos y secretos por entorno; revisá `vercel env ls` sin imprimir valores.

## Deploy checklist

1. Ejecutar `pnpm test`, `pnpm typecheck` y `pnpm build`.
2. Ejecutar `pnpm gauntlet migrate --from <snapshot>` con `DATABASE_URL` y `GAUNTLET_SECRETS_KEY` configurados.
3. Verificar `GET /api/health` y `GET /api/health?readiness=1`.
4. Registrar la función `/api/inngest` en el proveedor durable.
5. Probar un gate async con una suite pequeña y verificar `queued → running → pass/fail/error`.
6. Configurar el job `regression gate` como required status check en GitHub.
7. Activar logs/alertas de `503`, `429`, jobs con retries y gates `error`.

## Contrato de datos reproducibles

Los datasets se guardan como versiones inmutables con checksum SHA-256 sobre los items ordenados. El mismo nombre y versión sólo puede reutilizarse con el mismo checksum. Limitá cada versión a 1000 items y cada evento de trace a 64 KiB por payload; el endpoint batch admite hasta 100 eventos por request y devuelve rechazos por índice sin devolver el contenido.

Los evaluadores determinísticos (`contains`, `regex`, `exact_json`) se ejecutan sin llamar al juez de modelo. Los casos sin evaluator mantienen el camino model-based existente. Para un gate basado en dataset, crear una suite con `agentId`: sus items se materializan como casos y quedan sujetos a la misma comparación contra baseline, límites de concurrencia y auditoría que los casos promovidos desde traces.

## Inngest sin Marketplace de Vercel

Si el Marketplace no puede crear el recurso, la integración se puede configurar directamente en Inngest Cloud:

1. Crear una cuenta en [Inngest Cloud](https://app.inngest.com/) y seleccionar el entorno `Production`.
2. En `Manage → Event keys`, crear una key exclusiva para `gauntlet` y copiarla una sola vez.
3. En `Manage → Signing key`, copiar la signing key del mismo entorno. Para rotarla sin downtime, cargar la nueva como `INNGEST_SIGNING_KEY` y conservar la anterior temporalmente como `INNGEST_SIGNING_KEY_FALLBACK`.
4. En Vercel, cargar ambas credenciales como Secrets, sólo en el entorno correspondiente:

```bash
vercel env add INNGEST_EVENT_KEY production --sensitive
vercel env add INNGEST_SIGNING_KEY production --sensitive
```

5. Después de que una versión pública exponga `/api/inngest`, sincronizarla desde `Apps → Sync New App` usando `https://<deployment-vercel>/api/inngest`. Alternativamente, un administrador puede crear una API key de Inngest y ejecutar (ver la [guía oficial de sync](https://www.inngest.com/docs/apps/cloud)):

```bash
curl -X POST "https://api.inngest.com/v2/apps/gauntlet/syncs" \
  -H "Authorization: Bearer $INNGEST_API_KEY" \
  -H "content-type: application/json" \
  -d '{"url":"https://<deployment-vercel>/api/inngest"}'
```

6. Si Vercel Deployment Protection está activo, configurar el secret de bypass de automatización en la integración de Inngest o permitir el endpoint `/api/inngest`.
7. Verificar `GET /api/health?readiness=1` con `200`, consultar `GET /api/inngest` y ejecutar un gate async de una sola case.

Estos pasos requieren acceso de administrador a Inngest y a las variables de entorno de Vercel. No guardes ninguna de esas keys en Git, logs o tickets.

## Escalado y resiliencia

El límite de workers evita que un burst de PRs sature endpoints externos. El rate limiter usa un contador atómico por workspace en Postgres, por lo que funciona entre instancias. La cola es at-least-once: el worker no debe generar efectos externos irreversibles y todas las escrituras de resultado son idempotentes.

Usá un read replica para reporting si el dashboard crece; no apuntes escrituras a una replica. Neon puede suspender compute inactivo: el primer request después de scale-to-zero tiene cold start, por eso readiness no debe usarse como prueba de latencia del agente.

## Incidentes

- `503 readiness`: comprobar Neon, `INNGEST_*` y el deployment activo; no habilitar fallback SQLite en producción.
- cancelación sin efecto inmediato: confirmar que el run sigue `queued`/`running` y que el worker tiene acceso a Postgres; la señal compartida se respeta en el siguiente límite de ejecución.
- `429`: revisar `x-ratelimit-reset`, reducir concurrencia del cliente y confirmar que no haya un loop de ingestión.
- gate stuck en `running`: revisar el job durable y sus retries; no crear un gate nuevo para “destrabarlo” hasta confirmar si el job original agotó retries.
- secrets ilegibles: detener workers, restaurar `GAUNTLET_SECRETS_KEY` correcta y verificar el key versionado fuera del repo.
