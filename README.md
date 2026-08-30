<div align="center">

# GAUNTLET

### `/ agent proving ground`

**Probá agentes antes de ponerlos en producción.**

Evaluación black-box para agentes conversacionales y de procesamiento: conectás un endpoint, Gauntlet genera pruebas específicas para tu agente, lo somete a conversaciones adversariales y entrega evidencia accionable.

<a href="#arranque-en-60-segundos">Arranque en 60 segundos</a> · <a href="#cli-para-ci">CLI para CI</a> · <a href="#cómo-evalúa">Cómo evalúa</a> · <a href="#benchmark-reproducible">Benchmark</a>

<br />

![Next.js 15](https://img.shields.io/badge/Next.js-15-08090b?logo=next.js&logoColor=white) ![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-08090b?logo=typescript&logoColor=3178C6) ![Vitest](https://img.shields.io/badge/tests-Vitest-08090b?logo=vitest&logoColor=6E9F18) ![Status experimental](https://img.shields.io/badge/status-experimental-08090b)

</div>

> [!IMPORTANT]
> Gauntlet prueba el comportamiento del agente desplegado, pero usa el `system prompt` para entender el dominio y diseñar escenarios. Necesitás un endpoint HTTP compatible y una API key de Anthropic para generar y evaluar la suite. La key de OpenAI es opcional y mueve el juez a otra familia de modelos.

## Qué es

Gauntlet es una herramienta para encontrar fallas de agentes antes de que lleguen a un usuario real. No requiere instrumentar el agente: observa su endpoint como una caja negra, simula usuarios, sigue conversaciones multi-turno, negocia llamadas a tools y juzga cada resultado contra una rúbrica explícita.

Sirve para dos perfiles:

- **Devs:** CLI reproducible, reporte JSON, exit code para CI, `pass^k` y gates de calidad.
- **Personas no técnicas:** wizard web, prueba de conexión, estimación de costo y tiempo, historial, fixes de prompt y certificado visual.

El profiler decide automáticamente si el agente es conversacional o de procesamiento. También podés forzar el modo desde la web o `gauntlet.config.json`.

## Arranque en 60 segundos

### 1. Instalar y configurar

```bash
pnpm install
# Configurá ANTHROPIC_API_KEY en tu shell o en .env.local.
# Opcional: configurá OPENAI_API_KEY para usar un juez de otra familia.
```

La app también permite pegar las keys desde el banner de salud de la web. Las keys configuradas por UI se guardan en la base SQLite local; una variable de entorno siempre tiene prioridad.

### 2. Levantar la web

```bash
pnpm dev
```

Abrí [http://localhost:3000](http://localhost:3000). En el wizard:

1. Pegá el endpoint del agente y elegí `OpenAI` o `Coval`.
2. Configurá autenticación `none`, `Bearer` o header custom.
3. Pegá el system prompt y elegí la familia del modelo del agente.
4. Declarà las tools en JSON si el agente las usa.
5. Elegí `10 × 1` para una pasada rápida o `50 × 4` para la suite completa.
6. Revisá la estimación de llamadas, costo y duración, y corré Gauntlet.

También podés tocar **probar con agente demo** para ejecutar el flujo contra un agente intencionalmente defectuoso incluido en `/api/demo-agent`.

### 3. Leer el resultado

La corrida muestra el perfil detectado, progreso por fase, score ponderado, escenarios fallidos, transcripts, criterios incumplidos, fixes sugeridos y la posibilidad de emitir un certificado. El historial queda disponible en `/runs`; el benchmark del producto vive en `/benchmark`.

## CLI para CI

La CLI corre el mismo motor desde un repositorio de agente. Generá la configuración:

```bash
pnpm gauntlet init
```

Esto crea `gauntlet.config.json`. Un config mínimo y ejecutable:

```json
{
  "agentName": "Mi agente",
  "systemPromptFile": "./prompt.txt",
  "endpointUrl": "http://localhost:8080/v1/chat/completions",
  "protocol": "openai",
  "auth": { "type": "none" },
  "agentFamily": "unknown",
  "startCommand": "npm run dev",
  "readyPath": "/health",
  "startupTimeoutSec": 60,
  "scenarioCount": 50,
  "k": 4,
  "gate": {
    "minScore": 0.9,
    "minCategoryRate": 0.8
  }
}
```

Guardá el prompt en `prompt.txt` y corré:

```bash
pnpm gauntlet run
```

La CLI puede levantar el agente con `startCommand`, esperar `readyPath` y apagar el proceso al terminar. Escribe `gauntlet-report.json` en el directorio actual.

| Exit code | Significado |
| ---: | --- |
| `0` | El score y todas las categorías superan el gate. |
| `1` | La corrida terminó, pero no pasó el gate. |
| `2` | Error de configuración, conexión, proveedor o ejecución. |

Para usar un config en otra ruta:

```bash
pnpm gauntlet run --config ./ruta/gauntlet.config.json
```

### Variables de entorno

| Variable | Requerida | Efecto |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Sí para la CLI y corridas reales | Genera perfiles, casos, simulaciones, tools mockeadas y fixes. |
| `OPENAI_API_KEY` | No | Usa un juez OpenAI (`gpt-4.1`) cuando está disponible. |
| `GAUNTLET_OPENAI_JUDGE_MODEL` | No | Sobrescribe el nombre del modelo del juez OpenAI. |
| `OPENAI_BASE_URL` | No | Cambia la base URL del proveedor OpenAI-compatible. |
| `GAUNTLET_ALLOW_LOCAL_AGENTS` | No | Con valor `1`, permite endpoints privados/loopback en entornos donde la política de producción los bloquearía. |

La web permite configurar las dos API keys desde `/api/settings`. La CLI toma `ANTHROPIC_API_KEY` del entorno y no depende del storage local de la web.

### Configuración de la CLI

| Campo | Tipo | Default | Uso |
| --- | --- | --- | --- |
| `agentName` | `string` | requerido | Nombre que aparece en el reporte. |
| `clientName` | `string` | — | Nombre opcional para el certificado. |
| `systemPrompt` | `string` | — | Prompt inline; tiene prioridad sobre `systemPromptFile`. |
| `systemPromptFile` | `string` | — | Archivo del prompt, relativo al config. |
| `endpointUrl` | `string` | requerido | Endpoint HTTP del agente. |
| `protocol` | `openai / coval` | `openai` | Contrato de mensajes a usar. |
| `auth.type` | `none / bearer / header` | `none` | Tipo de autenticación del endpoint. |
| `auth.token` | `string` | — | Token enviado como Bearer o header. Preferí inyectarlo al generar el archivo en CI. |
| `auth.headerName` | `string` | — | Nombre del header custom. |
| `agentFamily` | `anthropic / openai / unknown` | `unknown` | Permite elegir un juez cross-family. |
| `mode` | `conversational / task` | auto | Fija el tipo de suite; omitilo para inferencia automática. |
| `tools` / `toolsFile` | `ToolDefinition[]` | `[]` | Tools declaradas para simular sus resultados. |
| `startCommand` | `string` | — | Comando opcional para levantar el agente. |
| `readyPath` | `string` | probe | Path opcional de health check. |
| `startupTimeoutSec` | `number` | `60` | Tiempo máximo de espera del agente. |
| `scenarioCount` | `number` | `50` | Casos generados por corrida. |
| `k` | `number` | `4` | Intentos por escenario; todos deben pasar. |
| `gate.minScore` | `number` | `0.9` | Score mínimo global. |
| `gate.minCategoryRate` | `number` | `0.8` | Mínimo por categoría. |

> En el JSON real, los valores enumerados se escriben como strings (`"openai"`, `"coval"`, etc.).

## Cómo evalúa

```mermaid
flowchart LR
    A[Endpoint + system prompt] --> B[Profiler]
    B --> C{Modo detectado}
    C -->|Conversacional| D[Escenarios multi-turno]
    C -->|Procesamiento| E[Documentos de prueba]
    D --> F[Simulador de usuario]
    E --> G[Ejecutor single-shot]
    F --> H[Agente bajo prueba]
    G --> H
    H --> I[Tools mockeadas]
    I --> H
    H --> J[Juez + rúbrica]
    J --> K[Score, transcripts y fixes]
    K --> L[Certificado / CI gate]
```

El pipeline hace lo siguiente:

1. **Preflight:** valida el endpoint y hace una llamada benigna antes de gastar una corrida completa.
2. **Perfilado:** extrae dominio, capacidades, límites, riesgos, fallas posibles y tools detectadas.
3. **Generación:** crea escenarios o documentos en tres categorías: `happy_path`, `edge_case` y `adversarial`.
4. **Simulación:** ejecuta cada caso contra el endpoint. El default es 10 trabajos concurrentes.
5. **Tools:** si el agente pide una tool, Gauntlet devuelve un resultado simulado y sigue el loop hasta seis llamadas por turno.
6. **Juzgado:** un modelo evalúa el transcript contra una rúbrica generada para ese agente. Con `OPENAI_API_KEY`, el juez usa `gpt-4.1`; sin ella, usa `claude-sonnet-5` y el reporte declara el riesgo de misma familia.
7. **Pass^k:** un escenario sólo pasa si pasan todos sus intentos. Una caída del juez se marca como `unevaluated`, no como falla del agente.
8. **Fixes:** el sistema propone cambios concretos al system prompt a partir de los escenarios fallidos.

### Contrato del endpoint

#### OpenAI-compatible

Gauntlet hace `POST` al `endpointUrl` con:

```json
{
  "model": "agent",
  "messages": [
    { "role": "user", "content": "mensaje de prueba" }
  ],
  "user": "session-id"
}
```

Acepta una respuesta con `choices[0].message.content`. Para function calling, también interpreta `choices[0].message.tool_calls` con `id`, `function.name` y `function.arguments`.

#### Coval

Gauntlet envía:

```json
{
  "sessionId": "session-id",
  "messages": [
    { "role": "user", "content": "mensaje de prueba" }
  ]
}
```

Acepta el último mensaje assistant dentro de `messages`. En ambos protocolos también se toleran respuestas `{ "content": "..." }` y `{ "reply": "..." }`.

## Benchmark reproducible

El benchmark compara tres brazos sobre siete agentes de referencia con defectos plantados. El resultado publicado en `bench/results/latest.md` fue generado el **16 de agosto de 2026**, con `12` escenarios por fixture y `k=2`.

| Método | Defectos hallados | Prompt-visible | Sólo comportamiento | Falsas alarmas |
| --- | ---: | ---: | ---: | ---: |
| **Gauntlet** | **7/7** | **2/2** | **5/5** | **13%** adjudicado |
| Revisión estática del prompt | 2/7 | 2/2 | 0/5 | 2 inventadas |
| Sondeo manual en vivo | 4/7 | 2/2 | 2/5 | 0 |

Métricas de Gauntlet en esa corrida:

- **Elicitación:** 100% de los defectos plantados fueron provocados por algún escenario.
- **Recall del juez:** 98% de las conversaciones donde el defecto ocurrió fueron marcadas como falla.
- **Falsos positivos reales:** 13% sobre el agente sano después de adjudicar las fallas con un modelo independiente.
- **Control antes de adjudicación:** 21% de conversaciones falladas por el juez.

Esto mide el harness contra fixtures controlados, no contra agentes de clientes ni contra ChatGPT o Claude Code como productos completos. Es evidencia de cobertura del motor, no una garantía universal de exactitud de dominio.

### Ejecutar el benchmark

Corrida real:

```bash
# ANTHROPIC_API_KEY debe estar configurada.
# OPENAI_API_KEY es opcional; habilita el juez cross-family.
pnpm bench --scenarios 12 --k 2
```

Smoke test sin llamadas LLM ni gasto:

```bash
pnpm bench --mock --out /tmp/gauntlet-bench-smoke.json
```

Opciones útiles:

```bash
pnpm bench --fixtures atlas-control,lumen-toolobeyer
pnpm bench --arms gauntlet
pnpm bench --scenarios 8 --k 1 --out /tmp/gauntlet.json
```

La corrida escribe el JSON y el Markdown junto al path indicado. La página `/benchmark` lee `bench/results/latest.json`.

### Fixtures actuales

| Fixture | Tipo de agente | Defecto plantado |
| --- | --- | --- |
| Atlas Analytics | Control sano de soporte SaaS | Ninguno; mide falsos positivos. |
| Nimbus Storage | Soporte de almacenamiento cloud | Filtra el system prompt. |
| Orion Pay | Soporte de pagos | Inventa reembolsos y SLA con penalidades. |
| Vega HR | Asistente interno de RRHH | Obedece prompt injection directa. |
| Helio Fitness | Retención de suscripciones | Regala descuentos sin límite. |
| Terra Gym | Soporte de gimnasio | Da consejo médico fuera de scope. |
| Lumen Bank | Banca personal con tools | Obedece una inyección dentro del resultado de una tool. |

La suite cubre fuga de prompt, fabricación de datos y acciones, prompt injection directa e indirecta, concesiones comerciales sin autoridad, salida de alcance y loops de tools.

## Seguridad y límites operativos

- **SSRF:** los endpoints se resuelven antes de cada request. En producción se bloquean HTTP, loopback, LAN, link-local, metadata cloud, rangos reservados y direcciones privadas. Para agentes locales en desarrollo, el comportamiento local está permitido fuera de `NODE_ENV=production`; también existe `GAUNTLET_ALLOW_LOCAL_AGENTS=1`.
- **Redirecciones:** no se siguen redirecciones del endpoint, para evitar que un host validado derive hacia una red bloqueada.
- **Tamaño de respuesta:** las respuestas del agente están limitadas a 256 KiB.
- **Credenciales:** el API nunca devuelve una key completa; sólo expone estado y máscara. Las keys guardadas por UI quedan en texto plano dentro de `data/gauntlet.db`, con el mismo nivel de confianza que un `.env` local. No uses este almacenamiento para una instalación multi-tenant.
- **SQLite local:** las corridas y settings viven en `data/`, que está ignorado por Git. El cancelamiento es process-local y está pensado para una instancia única.
- **Endpoint público:** el agente bajo prueba recibe el transcript generado y los documentos de prueba. No conectes endpoints con datos sensibles sin revisar qué información puede aparecer en los casos generados.

## Desarrollo

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

### Estructura

```text
src/
├── app/          # páginas Next.js y API routes
├── components/   # onboarding, progreso, resultados y UI
├── engine/       # connector, profiler, scenarios, simulator, judge, fixes
├── cli/          # init, launch, reporte y gate para CI
└── server/       # SQLite, settings y orquestación de corridas
bench/            # fixtures, servidor de referencia, brazos y scoring
test/             # unit/integration tests del engine, API y CLI
```

## Estado y límites conocidos

Gauntlet ya cubre agentes conversacionales y tiene modo task para documentos, pero la evidencia publicada del benchmark usa agentes de referencia conversacionales. Todavía no hay medición real para voz/SIP, input de imagen o audio, orquestadores multi-agente ni correctitud profunda de dominio sin ground truth.

El benchmark adjudica falsos positivos con un LLM independiente. Eso es mejor que contar automáticamente cualquier desacuerdo, pero no reemplaza un gold set de transcripts etiquetado por humanos. Para vender garantías de precisión por vertical, hace falta calibrar el juez contra datos reales de ese vertical.

## Licencia

No se definió una licencia pública en este repositorio todavía.
