# Production platform: shared storage and durable execution

## Objetivo

Reemplazar el almacenamiento local como fuente de verdad en despliegues compartidos y ejecutar gates en workers durables, manteniendo los contratos existentes de API, SDK, MCP, CLI, dashboard y GitHub Actions.

## Orden de ejecución

1. **Fundación de infraestructura**
   - Provisionar Neon Postgres en Vercel para production, preview y development.
   - Provisionar un proveedor de durable execution y registrar sus variables sin exponer secretos.
   - Implementar schema versionado e idempotente para workspaces, miembros, roles, agentes, traces, casos, gates, jobs, auditoría y runs.
   - Implementar migración SQLite → Postgres con upsert, reporte de filas, checksum y reanudación segura.

2. **Tenancy, RBAC y secretos**
   - Resolver el principal desde API key con workspace y rol.
   - Aplicar mínimo privilegio a lectura, escritura, ejecución de agentes y administración de claves.
   - Cifrar credenciales de agentes con AES-256-GCM y exigir `GAUNTLET_SECRETS_KEY` fuera de development.
   - Registrar auditoría append-only para autenticación, cambios de control-plane, ingestión y gates.

3. **Cola durable de gates**
   - Crear un job persistente con deduplicación por `workspace/version/case-set`.
   - Publicar el job a un worker durable con retries, backoff y timeout.
   - Hacer que `POST /gates` soporte modo async con `202`, manteniendo el modo síncrono existente.
   - Hacer que el worker sea idempotente y que el dashboard/CLI puedan consultar progreso y resultado.

4. **Resiliencia y operación**
   - Rate limiting distribuido cuando exista Redis gestionado y fallback explícito sólo para development.
   - Liveness/readiness, métricas de latencia/error y correlation IDs sin payloads sensibles.
   - Backups, restore rehearsal, retención, RPO/RTO y runbook operativo documentados.
   - Deploy con funciones Node/Fluid Compute, límites de concurrencia y cron de housekeeping.

5. **UX y compatibilidad**
   - Estados queued/running/pass/fail/error visibles con polling y detalle de casos.
   - Mensajes accionables para configuración, permisos y fallas de worker.
   - Mantener payloads existentes y sumar campos opcionales sin romper clientes.

## Verificación

- Tests unitarios para criptografía, roles, rate limiting, deduplicación y migración.
- Integración contra SQLite aislado y Postgres provisionado cuando `DATABASE_URL` esté disponible.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, benchmark mock y benchmark de persistencia.
- `git diff --check`, auditoría de dependencias y revisión de que ningún secreto aparezca en logs o respuestas.
