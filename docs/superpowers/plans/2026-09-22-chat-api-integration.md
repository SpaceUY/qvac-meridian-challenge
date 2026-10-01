# Chat API Integration Implementation Plan

> **Para quien ejecute este plan:** en este repo, cada tarea se entrega en
> **bloques de ~50 líneas** (CLAUDE.md del repo raíz `Hackathon/`): antes de
> escribir, contexto (qué/por qué/alternativas descartadas); se escribe el
> bloque y se frena; se explica línea por línea; recién ahí el bloque
> siguiente. Si una tarea de abajo supera las ~50 líneas de código nuevo,
> se parte en dos bloques al ejecutarla — no se escribe todo de un saque.
> Por eso este plan **no** usa subagentes ni ejecución en lote: se ejecuta
> en esta misma sesión, tarea por tarea, con Lucas leyendo y preguntando en
> cada bloque.

**Goal:** conectar el front (React) con el orquestador real (`AgentService`)
a través de una API propia (Express), en vez de hablarle directo a LM
Studio — con carga del modelo visible al abrir la app (TanStack Query) y
respuesta de chat real (SSE, historial completo).

**Architecture:** la API es la única puerta (Camino A). Tres endpoints
nuevos (`GET /api/chat/status`, `POST /api/chat/preload`,
`POST /v1/chat/completions`) envuelven al `AgentService` ya existente. La
API siempre habla SSE, incluso hoy que la respuesta llega completa de una
sola vez. El front usa TanStack Query para el ciclo de vida de los dos
tipos de pedido (status/preload como query+mutation, envío de mensaje como
mutation) — nunca para el contenido que llega de a pedacitos, que sigue
en Zustand como hoy.

**Tech Stack:** Express (backend, ya existente), `@langchain/langgraph` +
`@langchain/core` (ya existente, vía `AgentService`), React 19 + Vite
(front, ya existente), `@tanstack/react-query` (nuevo), Zustand (ya
existente, sin cambios en su rol).

**Spec:** [`docs/superpowers/specs/2026-09-22-api-chat-integration-design.md`](../specs/2026-09-22-api-chat-integration-design.md)

## Global Constraints

- El front **nunca** llama a `/api/models/*` directo — todo pasa por los
  3 endpoints nuevos (Camino A, spec §1).
- La API **siempre** contesta `/v1/chat/completions` en SSE, incluso con
  un solo pedacito (spec §2).
- **Sin Axios.** Todo `fetch` nativo (spec §6) — el `mutationFn`/`queryFn`
  de TanStack solo envuelve el `fetch` que ya existía o uno nuevo del
  mismo estilo.
- TanStack Query envuelve el **ciclo de vida del pedido** (status,
  preload, envío de mensaje), nunca el contenido que llega de a pedacitos
  — eso sigue siendo responsabilidad de Zustand (spec §5).
- La API **no manda `system` messages** al orquestador — se filtran si
  vinieran en el body (acordado con Ernesto, spec §4).
- Archivos nuevos van junto a los que ya existen, mismo estilo de carpetas
  por tipo (`hooks/`, `lib/`, `components/` en el front; `chat/` como
  hermano de `models/` en el backend) — no se arranca una convención por
  feature (spec §7).
- **Sin tests automatizados en este plan** — decisión explícita y anotada
  en el spec (§8); cada tarea se verifica a mano (`curl`/Postman o la UI).
- `AgentService.invoke()` cambia de firma: de un `string` suelto a un
  array de `{ role: 'user' | 'assistant'; content: string }` — acordado
  con Ernesto por Slack el 22/09 (spec §4). Esto rompe el único otro
  caller (`ai/demo.ts`), que se actualiza en la misma tarea.

---

## Backend

### Task 1: `AgentService` acepta historial y expone estado de carga

**Files:**
- Modify: `apps/backend/src/ai/orchestrator/agentService.ts`
- Modify: `apps/backend/src/ai/demo.ts:11` (el único otro caller de `invoke()`)

**Interfaces:**
- Consumes: `ChatMessage` de `apps/backend/src/models/domain/types.ts`
  (`{ role: string; content: string }`, ya existente); `HumanMessage`,
  `AIMessage` de `@langchain/core/messages` (ya importados en el archivo).
- Produces: `AgentStatus = 'idle' | 'loading' | 'ready' | 'error'`;
  `AgentService.getStatus(): { status: AgentStatus; error?: string }`;
  `AgentService.invoke(messages: ChatMessage[]): Promise<string>` (firma
  nueva — Task 2 y 3 la consumen así).

- [ ] **Paso 1 — Contexto (se explica antes de escribir, no se codea todavía)**

Qué: `AgentService` hoy recibe un string suelto y no expone si el modelo
ya cargó. Hace falta que reciba el historial completo (acordado con
Ernesto) y que `preload()` dejo un estado consultable, para que el
endpoint de status (Task 2) tenga algo real que contestar.

Alternativas descartadas: pegotear el historial en un solo string (spec
§4, descartada porque Qwen3-600M tiene ventana de contexto chica); trackear
el estado desde afuera de `AgentService` en el router (se descarta porque
duplicaría la fuente de verdad — el estado de carga es de este objeto).

- [ ] **Paso 2 — El código**

```typescript
import * as os from "node:os";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatQVAC } from "./qvacChatModel.js";
import { createGraph } from "./graph.js";
import type { ModelManagementService } from "../../models/service/models.service.js";
import type { ChatMessage } from "../../models/domain/types.js";
import {
  RESOURCE_THRESHOLDS,
  LOW_RESOURCE_MODEL,
  HIGH_RESOURCE_MODEL,
  type AgentModelConfig,
} from "../../config/agentService.config.js";

const BYTES_PER_GB = 1024 ** 3;

export type AgentStatus = "idle" | "loading" | "ready" | "error";

/**
 * Preloads a QVAC chat model and compiles the stock-assistant graph around
 * it once, so repeated `invoke()` calls reuse both instead of rebuilding
 * them per request. Also tracks its own load status so an HTTP layer has
 * something real to report (see `chat.router.ts`).
 */
export class AgentService {
  private readonly chatModel: ChatQVAC;
  private readonly graph: ReturnType<typeof createGraph>;
  private status: AgentStatus = "idle";
  private statusError: string | undefined;

  constructor(service: ModelManagementService) {
    const { modelSource, temperature, ctxSize } = this.selectModelConfig();
    this.chatModel = new ChatQVAC({ service, modelSource, temperature, ctxSize });
    this.graph = createGraph(this.chatModel);
  }

  private selectModelConfig(): AgentModelConfig {
    const ramGB = os.totalmem() / BYTES_PER_GB;
    const cpuCores = os.cpus().length;
    const isLowResource =
      ramGB < RESOURCE_THRESHOLDS.minRamGB || cpuCores < RESOURCE_THRESHOLDS.minCpuCores;
    return isLowResource ? LOW_RESOURCE_MODEL : HIGH_RESOURCE_MODEL;
  }

  /** The current load status — polled by `GET /api/chat/status` (Task 2). */
  getStatus(): { status: AgentStatus; error?: string } {
    return this.statusError ? { status: this.status, error: this.statusError } : { status: this.status };
  }

  /** Idempotent: a second call while `loading`/`ready` does nothing new. */
  async preload(): Promise<void> {
    if (this.status === "loading" || this.status === "ready") return;
    this.status = "loading";
    this.statusError = undefined;
    try {
      await this.chatModel.ensureModel();
      this.status = "ready";
    } catch (err) {
      this.status = "error";
      this.statusError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Sends the full conversation history through the graph, returns the assistant's reply text. */
  async invoke(messages: ChatMessage[]): Promise<string> {
    const result = await this.graph.invoke({ messages: messages.map(toLangChainMessage) });
    const lastAIMessage = [...result.messages]
      .reverse()
      .find((message): message is AIMessage => AIMessage.isInstance(message));
    return lastAIMessage?.text ?? "";
  }
}

function toLangChainMessage(message: ChatMessage): HumanMessage | AIMessage {
  return message.role === "assistant" ? new AIMessage(message.content) : new HumanMessage(message.content);
}
```

Y en `apps/backend/src/ai/demo.ts`, el único otro lugar que llama a
`invoke()` con la firma vieja — cambia esta línea:

```typescript
// antes:
result = await agentService.invoke(
  "Can you give me all the stock information about SKU: SD-X4-HT?",
);
// después:
result = await agentService.invoke([
  { role: "user", content: "Can you give me all the stock information about SKU: SD-X4-HT?" },
]);
```

- [ ] **Paso 3 — Verificación manual**

```bash
npm run model-lifecycle-demo --workspace=apps/backend
```

No es el demo correcto para esto (ese es de `ModelManagementService`, no
de `AgentService`) — la verificación real de este paso es:

```bash
npx tsx --workspace=apps/backend apps/backend/src/ai/demo.ts
```

Esperado: igual que antes del cambio — el demo imprime la respuesta del
stock del SKU `SD-X4-HT`, sin errores de tipo ni de runtime.

- [ ] **Paso 4 — Commit**

```bash
git add apps/backend/src/ai/orchestrator/agentService.ts apps/backend/src/ai/demo.ts
git commit -m "feat(backend): accept message history and track load status in AgentService"
```

---

### Task 2: Endpoints `GET /api/chat/status` y `POST /api/chat/preload`

**Files:**
- Create: `apps/backend/src/chat/chat.router.ts`
- Modify: `apps/backend/src/server.ts`

**Interfaces:**
- Consumes: `AgentService.getStatus()`, `AgentService.preload()` (Task 1).
- Produces: `createChatStatusRouter(agentService: AgentService): Router`
  — usado por Task 3 como hermano (`createCompletionsRouter`, en el mismo
  archivo) y por `server.ts`.

- [ ] **Paso 1 — Contexto**

Qué: los dos endpoints más simples primero, para verificar el wiring
(construcción de `AgentService`, montaje del router) antes de meterle el
SSE del Task 3 encima.

Por qué acá y no en `models/router/`: es un feature distinto (el
orquestador, no el ciclo de vida de modelos), sigue el mismo patrón de
carpeta que ya usa `models/` pero como su propio hermano.

- [ ] **Paso 2 — El código**

```typescript
import { Router, type Request, type Response } from "express";
import type { AgentService } from "../ai/orchestrator/agentService.js";

/** `GET /status` + `POST /preload`, mounted at `/api/chat` in server.ts. */
export function createChatStatusRouter(agentService: AgentService): Router {
  const router = Router();

  router.get("/status", (_req: Request, res: Response) => {
    res.json(agentService.getStatus());
  });

  // Fire-and-forget: the caller polls /status for progress instead of
  // waiting here — loading can take a while the first time (download).
  router.post("/preload", (_req: Request, res: Response) => {
    agentService.preload().catch((err: unknown) => {
      console.error("[chat:preload]", err);
    });
    res.status(202).json(agentService.getStatus());
  });

  return router;
}
```

Y en `apps/backend/src/server.ts`, agregar (junto a lo ya existente, sin
tocar `/api/models`):

```typescript
import { AgentService } from "./ai/orchestrator/agentService.js";
import { createChatStatusRouter } from "./chat/chat.router.js";
// ...
const agentService = new AgentService(modelManagementService);
app.use("/api/chat", createChatStatusRouter(agentService));
```

(la línea `app.use("/api/models", ...)` ya existente no se toca)

- [ ] **Paso 3 — Verificación manual**

```bash
npm run dev:server
```

En otra terminal:

```bash
curl -s http://localhost:3001/api/chat/status
# Esperado: {"status":"idle"}

curl -s -X POST http://localhost:3001/api/chat/preload
# Esperado: {"status":"loading"}  (o {"status":"ready"} si ya estaba cargado)

curl -s http://localhost:3001/api/chat/status
# repetir cada pocos segundos hasta ver {"status":"ready"}
```

- [ ] **Paso 4 — Commit**

```bash
git add apps/backend/src/chat/chat.router.ts apps/backend/src/server.ts
git commit -m "feat(backend): add model status and preload endpoints"
```

---

### Task 3: Endpoint `POST /v1/chat/completions` (SSE)

**Files:**
- Create: `apps/backend/src/chat/chat.router.const.ts`
- Create: `apps/backend/src/chat/chat.router.helpers.ts`
- Modify: `apps/backend/src/chat/chat.router.ts` (agrega `createCompletionsRouter`)
- Modify: `apps/backend/src/server.ts`

**Interfaces:**
- Consumes: `AgentService.getStatus()`, `AgentService.invoke(messages)`
  (Task 1); `ChatMessage` de `models/domain/types.ts`.
- Produces: `createCompletionsRouter(agentService: AgentService): Router`,
  montado en `server.ts`.

- [ ] **Paso 1 — Contexto**

Qué: el endpoint que de verdad habla con el orquestador. Valida el body
(formato OpenAI), filtra cualquier `system` que llegara colado, chequea
que el modelo esté `ready`, y siempre contesta SSE — un solo pedacito
hoy, tal como quedó decidido (spec §2).

Alternativa descartada: devolver JSON plano cuando no hay streaming real.
Se descarta porque el front ya espera SSE (`chat-client.ts`, existente) y
el objetivo es que no tenga que cambiar cuando el streaming real llegue.

- [ ] **Paso 2 — El código: constantes y helpers (~35 líneas)**

`apps/backend/src/chat/chat.router.const.ts`:

```typescript
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export const MODEL_NOT_READY_ERROR = "model not ready";
export const COMPLETION_ERROR = "could not generate a response";
export const INVALID_MESSAGES_ERROR = "invalid messages";
```

`apps/backend/src/chat/chat.router.helpers.ts`:

```typescript
import type { ChatMessage } from "../models/domain/types.js";

/** Parses the OpenAI-shaped `messages` array, dropping any `system` role — the API never forwards those (spec §4). */
export function parseMessages(body: unknown): ChatMessage[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.messages)) return undefined;
  const messages: ChatMessage[] = [];
  for (const entry of body.messages) {
    if (!isRecord(entry)) return undefined;
    if (entry.role === "system") continue;
    if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") {
      return undefined;
    }
    messages.push({ role: entry.role, content: entry.content });
  }
  return messages.length > 0 ? messages : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One OpenAI-shaped SSE chunk carrying the full text as a single delta. */
export function toTextChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/** The closing chunk (empty delta + finish_reason) followed by the SSE terminator. */
export function toDoneChunk(): string {
  return `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
}
```

- [ ] **Paso 3 — Verificación manual (de los helpers, antes de enchufarlos)**

No hay test automatizado (fuera de alcance, ver Global Constraints), pero
antes de seguir, confirmar a mano en una consola de Node (`node --input-type=module`)
que `parseMessages({ messages: [{role:'system',content:'x'},{role:'user',content:'hola'}] })`
devuelve `[{role:'user',content:'hola'}]` (el `system` se filtra) — es la
parte con más lógica de este paso y la más fácil de tipear mal.

- [ ] **Paso 4 — El código: el router (~30 líneas)**

Se agrega a `apps/backend/src/chat/chat.router.ts` (junto a
`createChatStatusRouter` del Task 2):

```typescript
import { parseMessages, toTextChunk, toDoneChunk } from "./chat.router.helpers.js";
import { SSE_HEADERS, MODEL_NOT_READY_ERROR, COMPLETION_ERROR, INVALID_MESSAGES_ERROR } from "./chat.router.const.js";

/** `POST /completions`, mounted at `/v1/chat`. Always SSE, even a single chunk (spec §2). */
export function createCompletionsRouter(agentService: AgentService): Router {
  const router = Router();

  router.post("/completions", async (req: Request, res: Response) => {
    const messages = parseMessages(req.body);
    if (!messages) {
      res.status(400).json({ error: INVALID_MESSAGES_ERROR });
      return;
    }
    if (agentService.getStatus().status !== "ready") {
      res.status(503).json({ error: MODEL_NOT_READY_ERROR });
      return;
    }

    res.writeHead(200, SSE_HEADERS);
    try {
      const text = await agentService.invoke(messages);
      res.write(toTextChunk(text));
    } catch (err) {
      console.error("[chat:completions]", err);
      res.write(toTextChunk(COMPLETION_ERROR));
    } finally {
      res.write(toDoneChunk());
      res.end();
    }
  });

  return router;
}
```

Y en `server.ts`, junto al `app.use` del Task 2:

```typescript
import { createChatStatusRouter, createCompletionsRouter } from "./chat/chat.router.js";
// ...
app.use("/v1/chat", createCompletionsRouter(agentService));
```

- [ ] **Paso 5 — Verificación manual end-to-end**

```bash
npm run dev:server
curl -s -X POST http://localhost:3001/api/chat/preload
# esperar a que /api/chat/status diga "ready"

curl -N -X POST http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-600m-inst-q4","messages":[{"role":"user","content":"Say hi in one word"}],"stream":true}'
```

Esperado: dos líneas `data: ...` (el texto, después `[DONE]`), sin
errores. Probar también con el modelo **no** `ready` todavía (recién
arrancado el server, sin llamar a `/preload`): debe responder `503` con
`{"error":"model not ready"}`.

- [ ] **Paso 6 — Commit**

```bash
git add apps/backend/src/chat/
git commit -m "feat(backend): add streaming chat completions endpoint"
```

---

## Frontend

### Task 4: TanStack Query — instalación y provider

**Files:**
- Modify: `apps/frontend/package.json`
- Create: `apps/frontend/src/lib/query-client.ts`
- Modify: `apps/frontend/src/main.tsx`

**Interfaces:**
- Produces: `queryClient` (instancia de `QueryClient`), usado por Task 5.

- [ ] **Paso 1 — Contexto**

Qué: sin esto, ningún `useQuery`/`useMutation` de las tareas siguientes
funciona — hace falta el `<QueryClientProvider>` envolviendo la app. Es
el primer contacto real de Lucas con la librería.

- [ ] **Paso 2 — El código**

```bash
npm install @tanstack/react-query@^5.103.2 --workspace=apps/frontend
```

`apps/frontend/src/lib/query-client.ts`:

```typescript
import { QueryClient } from '@tanstack/react-query'

/** One instance for the whole app — every useQuery/useMutation shares this cache. */
export const queryClient = new QueryClient()
```

`apps/frontend/src/main.tsx` (reemplaza el archivo completo — son 10
líneas):

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Paso 3 — Verificación manual**

```bash
npm run dev:client
```

Abrir `http://localhost:5173` — debe cargar igual que antes (todavía no
hay ningún `useQuery` real usándolo), sin errores en la consola del
navegador.

- [ ] **Paso 4 — Commit**

```bash
git add apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/src/lib/query-client.ts apps/frontend/src/main.tsx
git commit -m "chore(frontend): install and wire up TanStack Query"
```

---

### Task 5: Hook de estado del modelo (`useModelStatus`)

**Files:**
- Create: `apps/frontend/src/lib/model-status-client.ts`
- Create: `apps/frontend/src/hooks/use-model-status.ts`

**Interfaces:**
- Consumes: `queryClient` (Task 4, vía `QueryClientProvider` ya montado).
- Produces: `type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'`;
  `useModelStatus(): { status: ModelStatus; error?: string }` — usado por
  Task 6.

- [ ] **Paso 1 — Contexto**

Qué: el `fetch` tipado a los dos endpoints del Task 2, más el hook que
combina `useQuery` (pregunta el status, se repregunta solo mientras
carga) con `useMutation` (dispara el preload una vez).

Alternativa descartada: un solo `useQuery` con `refetchOnMount` disparando
el preload como side-effect del `queryFn` mismo — se descarta porque
mezclaría una lectura (`GET /status`) con una escritura (`POST /preload`)
en la misma función, lo que TanStack Query espera mantener separado
(`queryFn` sin side-effects, `mutationFn` para las escrituras).

- [ ] **Paso 2 — El código: el cliente HTTP (~20 líneas)**

`apps/frontend/src/lib/model-status-client.ts`:

```typescript
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ModelStatusResponse = { status: ModelStatus; error?: string }

export async function fetchModelStatus(): Promise<ModelStatusResponse> {
  const res = await fetch('/api/chat/status')
  if (!res.ok) throw new Error(`status check failed: ${res.status}`)
  return res.json()
}

export async function triggerPreload(): Promise<ModelStatusResponse> {
  const res = await fetch('/api/chat/preload', { method: 'POST' })
  if (!res.ok) throw new Error(`preload failed: ${res.status}`)
  return res.json()
}
```

- [ ] **Paso 3 — El código: el hook (~25 líneas)**

`apps/frontend/src/hooks/use-model-status.ts`:

```typescript
import { useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { fetchModelStatus, triggerPreload, type ModelStatus } from '@/lib/model-status-client'

const STATUS_QUERY_KEY = ['model-status']
// Cuánto esperamos entre preguntas mientras el modelo todavía no está listo.
const POLL_MS = 1000

export function useModelStatus(): { status: ModelStatus; error?: string } {
  const query = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchModelStatus,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'ready' || status === 'error' ? false : POLL_MS
    },
  })

  const preload = useMutation({ mutationFn: triggerPreload })

  // Dispara el preload UNA sola vez, apenas sabemos que está 'idle'.
  // preload.status pasa a 'pending' en el mismo render que se llama a
  // mutate(), así que no se puede disparar dos veces por este efecto.
  useEffect(() => {
    if (query.data?.status === 'idle' && preload.status === 'idle') {
      preload.mutate()
    }
  }, [query.data?.status, preload])

  return { status: query.data?.status ?? 'idle', error: query.data?.error }
}
```

- [ ] **Paso 4 — Verificación manual**

Con `npm run dev:server` corriendo (backend, del Task 2/3) y
`npm run dev:client` corriendo, agregar temporalmente
`console.log(useModelStatus())` en `App.tsx` (se saca en el Task 6, que
lo reemplaza por el uso real) y mirar la consola del navegador: debe
pasar de `{status: 'idle'}` a `{status: 'loading'}` (repitiéndose cada
segundo) a `{status: 'ready'}`, sin quedarse repitiendo para siempre.

- [ ] **Paso 5 — Commit**

```bash
git add apps/frontend/src/lib/model-status-client.ts apps/frontend/src/hooks/use-model-status.ts
git commit -m "feat(frontend): add useModelStatus hook (TanStack Query)"
```

---

### Task 6: Estado real en el panel derecho y el composer

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/components/engine-panel.tsx`
- Modify: `apps/frontend/src/components/chat-panel.tsx`
- Modify: `apps/frontend/src/components/composer.tsx`

**Interfaces:**
- Consumes: `useModelStatus()` (Task 5).
- Produces: `Composer` gana un prop `disabled?: boolean`; `ChatPanel`
  gana un prop `modelStatus: ModelStatus`.

- [ ] **Paso 1 — Contexto**

Qué: la sección "Inference" del panel derecho (hoy fake) pasa a mostrar
el estado real; el resto del panel (CPU, RAM, nombre del modelo) sigue
con datos fake — fuera de alcance de este plan (spec, "Fuera de
alcance"). El composer se deshabilita mientras el modelo no esté listo.

- [ ] **Paso 2 — El código: `engine-panel.tsx` (~20 líneas modificadas)**

Reemplazar la sección "Inference" (ya traducida a inglés en el commit
anterior) por una versión que recibe el status real en vez de derivarlo
de `state.mode`. Archivo completo (reemplaza el existente entero — las
secciones "Chat model", "This machine" y "Selected profile", más los
helpers `Section`/`Kv` del final, no cambian de contenido, solo de
lugar en el archivo):

```typescript
import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import type { FAKE_ENGINE_STATE } from '@/lib/fake-data'
import type { ModelStatus } from '@/lib/model-status-client'

type EngineState = typeof FAKE_ENGINE_STATE
type Props = { state: EngineState; modelStatus: ModelStatus; statusError?: string }

const STATUS_LABEL: Record<ModelStatus, string> = {
  idle: 'Starting…',
  loading: 'Loading model…',
  ready: 'Running locally',
  error: 'Load failed',
}
const STATUS_COLOR: Record<ModelStatus, string> = {
  idle: 'text-muted-foreground',
  loading: 'text-amber-500',
  ready: 'text-emerald-500',
  error: 'text-destructive',
}

/** Right panel: "with what" the assistant runs. Req. [5.1] + [5.1.1] + [5.2]. */
export function EnginePanel({ state, modelStatus, statusError }: Props) {
  const ramPercent = Math.round((state.usedRamGb / state.availableRamGb) * 100)

  return (
    <div className="flex flex-col gap-4 text-sm">
      <Section title="Inference">
        <div className={`flex items-center gap-1.5 font-medium ${STATUS_COLOR[modelStatus]}`}>
          <span className="size-1.5 rounded-full bg-current" />
          {STATUS_LABEL[modelStatus]}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {modelStatus === 'error' ? statusError : 'No peers available.'}
        </p>
      </Section>

      <Separator />
      <Section title="Chat model">
        <Kv label="Name" value={state.model.name} />
        <Kv label="Quantization" value={state.model.quantization} />
        <Kv label="Context" value={`${state.model.context} tok`} />
        <Kv label="Speed" value={`${state.model.tokensPerSec} tok/s`} />
      </Section>

      <Separator />
      <Section title="This machine">
        <Kv label="CPU" value={state.machine.cpu} />
        <Kv label="RAM" value={`${state.machine.totalRamGb} GB`} />
        <p className="mt-2 text-xs text-muted-foreground">RAM used by the model</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${ramPercent}%` }} />
        </div>
      </Section>

      <Separator />
      <Section title="Selected profile">
        <p className="text-xs text-muted-foreground">{state.selectedProfile}</p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b py-1 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}
```

- [ ] **Paso 3 — El código: `composer.tsx` (~15 líneas modificadas)**

```typescript
type Props = {
  isStreaming: boolean
  disabled?: boolean
  onSend: (text: string) => void
  onStop: () => void
}

export function Composer({ isStreaming, disabled = false, onSend, onStop }: Props) {
  const [text, setText] = useState('')

  function send() {
    if (!text.trim() || isStreaming || disabled) return
    onSend(text)
    setText('')
  }
  // handleKeyDown no cambia

  return (
    <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border bg-secondary/50 p-2 shadow-sm">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? 'Loading the model…' : 'Pregunta lo que quieras'}
        rows={1}
        className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      {isStreaming ? (
        <Button size="icon" variant="destructive" className="shrink-0 rounded-full" onClick={onStop}>
          <Square className="size-4" />
        </Button>
      ) : (
        <Button size="icon" className="shrink-0 rounded-full" disabled={!text.trim() || disabled} onClick={send}>
          <Send className="size-4" />
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Paso 4 — El código: `chat-panel.tsx` y `App.tsx` (~15 líneas entre los dos)**

En `chat-panel.tsx`, agregar el prop y pasarlo al `Composer` — archivo
completo (solo cambian la firma de `Props`/`ChatPanel` y la línea del
`<Composer>`, el resto es idéntico al actual):

```typescript
import { ArrowDown } from 'lucide-react'
import { MessageList } from '@/components/message-list'
import { Composer } from '@/components/composer'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { useElementHeight } from '@/hooks/use-element-height'
import { useStickToBottom } from '@/hooks/use-stick-to-bottom'
import type { ModelStatus } from '@/lib/model-status-client'

type Props = { modelStatus: ModelStatus }

export function ChatPanel({ modelStatus }: Props) {
  const { history, isStreaming, sendMessage, stop } = useChat()
  const [overlayRef, overlayHeight] = useElementHeight<HTMLDivElement>()
  const { scrollRef, contentRef, isPinned, scrollToBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  function handleSend(text: string) {
    sendMessage(text)
    scrollToBottom()
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={contentRef}>
          <MessageList history={history} />
          <div aria-hidden style={{ height: overlayHeight }} />
        </div>
      </div>

      {!isPinned && (
        <Button
          size="icon"
          variant="secondary"
          aria-label="Ir al final de la conversacion"
          onClick={scrollToBottom}
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full border shadow-md"
          style={{ bottom: overlayHeight + 8 }}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}

      <div ref={overlayRef} className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="h-8 bg-linear-to-t from-background to-background/0" />
        <div className="pointer-events-auto bg-background px-3 pb-3">
          <Composer isStreaming={isStreaming} disabled={modelStatus !== 'ready'} onSend={handleSend} onStop={stop} />
        </div>
      </div>
    </div>
  )
}
```

En `App.tsx`:

```typescript
import { useModelStatus } from '@/hooks/use-model-status'

export default function App() {
  const modelStatus = useModelStatus()
  return (
    <AppShell
      leftSidebar={<CorpusPanel documents={FAKE_CORPUS} />}
      rightSidebar={<EnginePanel state={FAKE_ENGINE_STATE} modelStatus={modelStatus.status} statusError={modelStatus.error} />}
    >
      <ChatPanel modelStatus={modelStatus.status} />
    </AppShell>
  )
}
```

- [ ] **Paso 5 — Verificación manual**

```bash
npm run dev:server   # backend
npm run dev:client   # front, en otra terminal
```

Abrir `http://localhost:5173`: el panel derecho debe mostrar "Starting…"
o "Loading model…" con el composer deshabilitado (placeholder "Loading
the model…", no se puede escribir), y pasar solo a "Running locally"
(verde) + composer habilitado cuando el backend reporte `ready`. Apagar
el backend a mitad de carga y confirmar que se ve "Load failed" en rojo
con el motivo.

- [ ] **Paso 6 — Commit**

```bash
git add apps/frontend/src/App.tsx apps/frontend/src/components/engine-panel.tsx apps/frontend/src/components/chat-panel.tsx apps/frontend/src/components/composer.tsx
git commit -m "feat(frontend): show real model load status, gate composer on it"
```

---

### Task 7: El proxy de Vite apunta al backend real

**Files:**
- Modify: `apps/frontend/vite.config.ts`

**Interfaces:**
- Ninguna nueva — solo cambia a qué servidor llegan los `fetch` que ya
  existen (`chat-client.ts` del Task 8 y `model-status-client.ts` del
  Task 5 ya asumían este cambio).

- [ ] **Paso 1 — Contexto**

Qué: hasta acá, todo lo nuevo se armó y se verificó, pero el front
todavía le habla a LM Studio (`DESTINO = MOTOR.lmStudio`, sin tocar desde
el inicio del proyecto). Este es el único cambio que falta para que el
front hable con tu API real en vez de LM Studio — y por eso va **al
final**, cuando ya se probó todo por separado (Postman/curl para el
backend, consola del navegador para el hook) y no hay que debuggear dos
cosas nuevas al mismo tiempo.

- [ ] **Paso 2 — El código**

```typescript
const MOTOR = {
  /** LM Studio. Streamea de verdad, no tiene corpus ni citas. Para desarrollar. */
  lmStudio: 'http://127.0.0.1:1234',
  /** El backend Express del repo -> meridianGraph -> qvac serve. El producto real. */
  backend: 'http://127.0.0.1:3001',
}

const DESTINO = MOTOR.backend

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/v1': { target: DESTINO, changeOrigin: true },
      // /api/chat/* solo existe en TU backend — nunca en LM Studio, así
      // que no sigue el switch de arriba.
      '/api': { target: MOTOR.backend, changeOrigin: true },
    },
  },
})
```

- [ ] **Paso 3 — Verificación manual**

```bash
npm run dev:server   # backend real, puerto 3001
npm run dev:client   # front, reinicia el proxy al cambiar vite.config.ts
```

Abrir `http://localhost:5173`, esperar a "Running locally", escribir
"Hola" — la respuesta tiene que llegar del backend real (confirmable
mirando la consola de `npm run dev:server`: debe verse el log de
LangGraph invocando el modelo, no nada en la consola de LM Studio).

- [ ] **Paso 4 — Commit**

```bash
git add apps/frontend/vite.config.ts
git commit -m "feat(frontend): point the dev proxy at the real backend instead of LM Studio"
```

---

### Task 8: Envío de mensaje como `useMutation`

**Files:**
- Modify: `apps/frontend/src/hooks/use-chat.ts`

**Interfaces:**
- Consumes: `runTurn` (ya existente, sin cambios internos); `useMutation`
  de `@tanstack/react-query` (Task 4).
- Sin cambios en lo que expone `useChat()` hacia afuera — mismo
  `{ history, sendMessage, stop, isWaitingForFirstChunk, isStreaming }`
  que ya consume `chat-panel.tsx`.

- [ ] **Paso 1 — Contexto**

Qué: el último paso del diseño (spec §5) — `sendMessage` dispara un
`useMutation` cuya `mutationFn` es la misma `runTurn` que ya existe (no
se reescribe la lectura del stream). Se gana el patrón consistente de
"pedirle algo al servidor" en toda la app; se mantiene el `AbortController`
que ya existía para el botón de detener, porque `useMutation` no maneja
cancelación de streams por sí solo.

- [ ] **Paso 2 — El código (~15 líneas modificadas sobre `sendMessage`)**

```typescript
import { useMutation } from '@tanstack/react-query'
// ... el resto de los imports existentes se mantienen

export function useChat() {
  const history = useChatStore((state) => state.history)
  const sessionId = useSessionId()
  const historyRef = useMirrorRef(history)
  const abortRef = useRef<AbortController | null>(null)

  const turnMutation = useMutation({
    mutationFn: (args: { openAIMessages: OpenAIMessage[]; assistantMessageId: string; signal: AbortSignal }) =>
      runTurn({ ...args, sessionId }),
  })

  const sendMessage = useCallback((rawText: string) => {
    const text = rawText.trim()
    if (!text || abortRef.current) return

    const openAIMessages: OpenAIMessage[] = [
      ...toOpenAIMessages(historyRef.current),
      { role: 'user', content: text },
    ]

    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    useChatStore.getState().turnStarted(userMessageId, assistantMessageId, text)

    const controller = new AbortController()
    abortRef.current = controller

    turnMutation.mutate(
      { openAIMessages, assistantMessageId, signal: controller.signal },
      { onSettled: () => { abortRef.current = null } },
    )
  }, []) // sin dependencias: lee todo de refs, igual que antes

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return {
    history,
    sendMessage,
    stop,
    isWaitingForFirstChunk: isWaitingForFirstChunk(history),
    isStreaming: isStreaming(history),
  }
}
```

(la función `runTurn` de más abajo en el archivo, y `createChunkBuffer`,
no cambian — siguen leyendo el `ReadableStream` a mano, tal como dice el
spec §5)

- [ ] **Paso 3 — Verificación manual**

```bash
npm run dev:server
npm run dev:client
```

Mandar 2-3 mensajes seguidos por el chat: deben aparecer y responder
igual que antes de este cambio (visualmente nada cambia — el `useMutation`
es puramente interno). Probar también el botón de detener a mitad de una
respuesta: debe seguir cortando igual que antes.

- [ ] **Paso 4 — Verificación de lint y build (checklist de PR)**

```bash
npm run lint --workspace=apps/frontend
npm run build:client
npm run build:server
```

Esperado: los tres sin errores (`build:server` no tiene script propio
hoy — confirmar que no rompió nada revisando que `npm run dev:server`
siga arrancando).

- [ ] **Paso 5 — Commit**

```bash
git add apps/frontend/src/hooks/use-chat.ts
git commit -m "refactor(frontend): wrap message sending in a TanStack Query mutation"
```

---

## Al terminar

- Actualizar `Hackathon/qvac-context/05-estado-y-progreso.md`: front
  conectado al backend real, historial de mensajes end-to-end, TanStack
  Query en uso (status/preload + envío de mensaje). Anotar el hallazgo de
  `Qwen3.5-4B` vs `Qwen3-600M` en `agentService.config.ts` (spec, "Fuera
  de alcance") como pendiente de confirmar con el equipo.
- Abrir PR de `feat/chat-api-integration` → `main` con
  `/workflow:pull-request`, siguiendo el mismo flujo git usado para
  `feat/frontend-chat` (PR #10).
