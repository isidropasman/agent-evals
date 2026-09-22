# Backups y recuperación

## Objetivos

- RPO recomendado: 15 minutos para el control plane.
- RTO recomendado: 60 minutos para volver a aceptar gates.
- Retener snapshots de migración y reportes CI fuera del runtime.

## Backup

Neon mantiene historial y branches copy-on-write; configurá la retención del proyecto según el RPO contratado. Para un backup operativo adicional, usar la URL directa:

```bash
pg_dump --format=custom --no-owner --file=gauntlet-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL_UNPOOLED"
```

El dump debe cifrarse y almacenarse en un bucket privado con retención y acceso restringido. No subas dumps a Git ni los adjuntes a issues.

## Restore rehearsal

1. Crear un branch Neon temporal desde el punto de recuperación.
2. Aplicar las migraciones idempotentes y restaurar el dump en ese branch.
3. Ejecutar `pnpm typecheck`, el smoke de API y un gate de una sola case apuntando al branch.
4. Verificar conteos de workspaces, keys, agents, runs, traces, datasets, suites, cases, gates, jobs, audit events, `subscription_connections` y `subscription_usage`.
5. Medir el tiempo total y registrar el resultado en el runbook de operaciones.

Para recuperación real, cambiar `DATABASE_URL` en Vercel al branch restaurado, verificar readiness y sólo después volver a publicar eventos de gates pendientes. No ejecutes `pg_restore` sobre producción sin una ventana aprobada y un snapshot previo.

## SQLite local

SQLite sólo es una fuente de migración o desarrollo. Antes de migrar, copiá `data/gauntlet.db` con el proceso detenido y conservá el archivo original hasta validar el conteo en Postgres:

```bash
pnpm gauntlet migrate --from data/gauntlet.db
```

La migración prepara todos los inserts y los ejecuta en una única transacción de Postgres: un error de integridad hace rollback completo. Los conflictos son idempotentes y una reejecución sólo cuenta filas nuevas; corregí la causa y volvé a ejecutar sin borrar el destino. `subscription_connections` conserva sólo tokens OAuth cifrados para GitHub y `auth_mode=codex_local` con `access_token` vacío para Codex; el restore nunca contiene `~/.codex/auth.json`. Sin `GAUNTLET_SECRETS_KEY` el restore debe quedar detenido y no se deben reactivar evals. Después de una restauración, las conexiones Codex deben reconectarse en la máquina local con `codex login` y `POST /api/v1/subscriptions/codex/start`; no se restauran tokens locales desde Postgres.
