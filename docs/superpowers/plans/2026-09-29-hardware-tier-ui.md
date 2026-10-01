# Hardware Tier UI Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Este plan se ejecuta en una rama/worktree propia, nunca sobre `main`.** La Tarea 0
> crea el aislamiento antes de tocar un solo archivo — instrucción explícita de Lucas
> (29/09/2026). Además, cada tarea de este plan sigue el protocolo de bloques de
> `CLAUDE.md` (contexto → ~50 líneas → freno → explicación línea por línea) al
> ejecutarse con Lucas presente — este documento ya viene troceado en unidades de ese
> tamaño para que el corte no haya que decidirlo en el momento.

**Goal:** Mostrar en la UI el tier de hardware (`low` / `medium` / `high`) que el
backend ya detecta y usa hoy para elegir el modelo de chat/voz/transcripción, para
cumplir la fila "Modelo y perfil de hardware elegidos" del Ticket 11 (React Demo UI),
que mapea al requisito **[5.2]** del challenge.

**Architecture:** El backend ya resuelve el tier una sola vez por proceso
(`RESOURCE_TIER` en `resourceTier.ts`) y ya lo usa para elegir modelo en
`AgentService`, `TtsService` y `TranscriptionService`. No hace falta detectar nada
nuevo ni tocar esa lógica: solo **exponer** un valor que ya existe, en la respuesta
que el front ya está *pollendo*. El cambio atraviesa 3 capas finas y ya existentes —
`AgentService.getStatus()` → `fetchModelStatus()` → `EnginePanel` — sin agregar
ningún servicio, endpoint, ni store nuevo. Es la extensión más chica posible del
camino de datos que ya existe para "Name"/"Quantization" en el panel.

**Tech Stack:** TypeScript estricto (backend Node/Express/tsx, frontend React 19 +
Vite), Vitest en ambos workspaces (`<archivo>.test.ts` junto al archivo que testea),
`@tanstack/react-query` para el polling del estado del modelo, sin librería de
testing de componentes React (no existe hoy en el repo — ver Tarea 3).

**Spec:** No hay un doc de spec dedicado para este feature puntual (es chico y no
pasó por brainstorming). La fuente de verdad es:
- `qvac-context/01-challenge-texto-completo.md:202` — requisito **[5.2]**: *"we
  should ensure model and quantization selection at runtime based on device
  capability."*
- `qvac-context/06-tickets-proyecto-real.md:871,891` — Ticket 11 (React Demo UI):
  *"display the selected model/hardware profile for demonstration purposes"*, fila
  "Modelo y perfil de hardware elegidos" → [5.2].

Ambos viven en el repo hermano `Hackathon/` (fuera de este repo de código); se citan
acá para que quien ejecute el plan no tenga que ir a buscarlos.

## Global Constraints

- **`@qvac/sdk` sigue pinneado a `0.18.2` exacto** — este plan no toca `package.json`
  ni ninguna llamada al SDK.
- **TypeScript estricto** en frontend (`tsconfig.app.json`) y backend — cualquier
  campo nuevo en un `interface`/`type` que sea consumido en otro archivo con una
  anotación de tipo explícita (no inferida) rompe la compilación hasta que ese
  archivo se actualice también. Es la red de seguridad que este plan usa a propósito
  en la Tarea 1.
- **Convención de tests:** Vitest, archivo `<nombre>.test.ts` en el mismo directorio
  que el archivo que testea. Ningún test nuevo introduce un mock/spy que no siga el
  patrón `vi.stubGlobal('fetch', ...)` ya usado en `chat-store.test.ts` y
  `chat-client.test.ts`.
- **Cero dependencias nuevas.** En particular, no se instala `@testing-library/react`
  para este cambio (ver la caja ⚖️ de la Tarea 3) ni ningún paquete compartido
  `packages/shared-types` para un solo campo (ver la caja ⚖️ de la Tarea 2).
- **Nunca tocar `main` directamente.** Toda la ejecución vive en la rama
  `feat/hardware-tier-ui`, en el worktree `.claude/worktrees/hardware-tier-ui` (mismo
  patrón que `feat/ui-improvements`, `feat/p2p-peer-notifications`, etc., ya usados
  en este repo). El PR se abre recién cuando Lucas lo pida explícitamente.
- **`main` está limpio en `8c12884`** al momento de escribir este plan (verificado con
  `git status`) — es el punto de partida de la Tarea 0.

---

### ⚖️ La decisión de este lab — dónde exponer el tier

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **Sumarlo a `GET /api/chat/status`** (recomendada) | El front ya lo *pollea* cada 1-5 s para el estado del modelo (`use-model-status.ts`). El tier no cambia durante la vida del proceso (`resourceTier.ts:62`), así que viaja gratis en una respuesta que de todos modos ya viaja. Cero endpoint nuevo, cero round-trip nuevo. | Si el tier fuera a variar dinámicamente durante la sesión (no es el caso: se resuelve una sola vez al arrancar el proceso). |
| **Endpoint nuevo `GET /api/hardware`** | Si el tier fuera a crecer con más datos (RAM real, GPU, cores) que no tiene sentido meter en el status del chat — más "single responsibility" a nivel HTTP. | Acá es sobre-ingeniería: es un solo string que nunca cambia, agregarle su propio endpoint/poll es una pieza más para romperse por un dato que ya está disponible gratis en otro lado. |

**→ Se suma a `AgentStatusPayload` / `GET /api/chat/status`.**
**Diferencia con el proyecto real:** en Meridian esto es exactamente lo mismo — no
hay "versión de laboratorio" de esta decisión, porque el endpoint y el servicio ya
son el código real, no un stub del lab.

---

## Task 0: Aislar el trabajo en su propia rama/worktree

**Files:**
- Ninguno del código de la app — solo estado de git.

**Interfaces:**
- Consumes: nada.
- Produces: un worktree en
  `apps/../qvac-practice-0916/.claude/worktrees/hardware-tier-ui` sobre la rama
  `feat/hardware-tier-ui`, con dependencias instaladas, listo para que las tareas
  siguientes trabajen ahí. Ninguna tarea posterior toca `main`.

- [ ] **Step 1: Confirmar que `main` está limpio antes de ramificar**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916 && git status
```

Esperado: `On branch main` + `nothing to commit, working tree clean`. Si hay cambios
sin commitear, parar acá y decidir con Lucas qué hacer con ellos antes de continuar
(no descartarlos sin preguntar).

- [ ] **Step 2: Crear el worktree y la rama**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916 && git worktree add .claude/worktrees/hardware-tier-ui -b feat/hardware-tier-ui main
```

Esperado: `Preparing worktree (new branch 'feat/hardware-tier-ui')` y un directorio
nuevo en `.claude/worktrees/hardware-tier-ui`. **A partir de acá, todos los comandos
de este plan corren dentro de ese directorio**, no en el checkout principal.

- [ ] **Step 3: Instalar dependencias en el worktree**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npm ci
```

Esperado: instala sin errores (usa el `package-lock.json` existente, así que
`@qvac/sdk` queda en `0.18.2` exacto, sin resolver un rango nuevo).

- [ ] **Step 4: Foto del "antes" — correr toda la suite para tener un número de referencia**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npm run test --workspace=apps/backend && npm run test --workspace=apps/frontend
```

Esperado: todos los tests en verde (o la misma cantidad de fallas preexistentes que
ya hubiera en `main`, si las hay — anotar el número exacto para poder comparar
"antes vs. después" al cerrar la Tarea 3). **No seguir a la Tarea 1 si hay una falla
nueva acá que no se explique por este plan.**

- [ ] **Step 5: Commit — ninguno**

Esta tarea no genera commits (es solo setup de git). La Tarea 1 hace el primer commit
real, ya dentro del worktree.

---

## Task 1: Backend — exponer el tier resuelto en `AgentStatusPayload`

**Files:**
- Modify: `apps/backend/src/ai/orchestrator/agentService.ts:25-33` (interfaz),
  `apps/backend/src/ai/orchestrator/agentService.ts:80-104` (constructor),
  `apps/backend/src/ai/orchestrator/agentService.ts:115-124` (`getStatus()`)
- Modify (para que siga compilando): `apps/backend/src/chat/chat.router.test.ts:34-36`,
  `apps/backend/src/chat/chat.router.test.ts:231`
- Test: `apps/backend/src/ai/orchestrator/agentService.test.ts:308-328`

**Interfaces:**
- Consumes: `ResourceTier` (`'low' | 'medium' | 'high'`), ya exportado por
  `apps/backend/src/config/resourceTier.ts:3` e importado en `agentService.ts:20`.
  Nada nuevo que importar.
- Produces: `AgentStatusPayload` gana un campo obligatorio
  `hardwareTier: ResourceTier`. Es lo que consume la Tarea 2
  (`apps/frontend/src/lib/model-status-client.ts`) vía
  `GET /api/chat/status` — el router (`chat.router.ts:38`, `router.get("/status", ...)`)
  ya hace `res.json(agentService.getStatus())` sin cambios, así que el campo nuevo
  viaja solo con el cambio de esta tarea.

- [ ] **Step 1: Escribir el test que falla — `getStatus()` debe reportar el tier resuelto**

Insertar como nuevo `it(...)` dentro del `describe("AgentService model selection", ...)`
existente, **después** del `it` que termina en la línea 327 (`});`) y **antes** del
`});` que cierra el `describe` en la línea 328:

```ts
  it("reports the resolved hardware tier in its status payload", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
      "medium",
    );

    expect(agentService.getStatus().hardwareTier).toBe("medium");
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npx vitest run --root apps/backend src/ai/orchestrator/agentService.test.ts -t "reports the resolved hardware tier"
```

Esperado: FALLA — `agentService.getStatus().hardwareTier` es `undefined` (el campo
todavía no existe en el objeto que devuelve `getStatus()`; TypeScript ni siquiera
debería dejar compilar la referencia una vez que el tipo sea estricto, pero antes del
Step 3 el tipo `AgentStatusPayload` **todavía no tiene** el campo declarado, así que
esta línea de test da error de tipo — "Property 'hardwareTier' does not exist on
type 'AgentStatusPayload'". Ese error de compilación **es** el rojo de este ciclo.

- [ ] **Step 3: Implementación mínima**

En `apps/backend/src/ai/orchestrator/agentService.ts`, agregar el campo a la
interfaz (línea 25-33):

```ts
export interface AgentStatusPayload {
  status: AgentStatus;
  error?: string;
  model: { name: string; quantization: string };
  /** The resource tier this process resolved at startup (`resourceTier.ts`) - the same value every tiered consumer (chat, TTS, STT) is using right now. */
  hardwareTier: ResourceTier;
  delegation?: LoadedModelDelegationInfo;
  recovering: boolean;
}
```

Guardar el tier como propiedad de instancia en el constructor (línea 80-86, agregar
`private readonly` delante de `tier` y usar `this.tier` donde antes se usaba el
parámetro):

```ts
  constructor(
    private readonly service: ModelManagementService,
    ragService: RagRetrievalService,
    documentRepository: DocumentRepository,
    private readonly tier: ResourceTier = RESOURCE_TIER,
  ) {
    const selectedModel = LLM_MODELS_BY_TIER[this.tier];
```

Y devolverlo desde `getStatus()` (línea 115-124):

```ts
  getStatus(): AgentStatusPayload {
    const delegation = this.chatModel.getCachedDelegationInfo();
    return {
      status: this.status,
      ...(this.statusError ? { error: this.statusError } : {}),
      model: this.modelInfo,
      hardwareTier: this.tier,
      ...(delegation ? { delegation } : {}),
      recovering: this.chatModel.isRecovering(),
    };
  }
```

- [ ] **Step 4: Correr el test de la Tarea y verificar que pasa**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npx vitest run --root apps/backend src/ai/orchestrator/agentService.test.ts -t "reports the resolved hardware tier"
```

Esperado: PASS.

- [ ] **Step 5: Arreglar los dos fakes que el compilador ahora rechaza**

El campo nuevo es obligatorio en `AgentStatusPayload`, así que dos objetos literales
en `chat.router.test.ts` que antes lo satisfacían dejan de compilar. Sin este paso,
`npm run test --workspace=apps/backend` falla entero (no solo el archivo nuevo).

En `apps/backend/src/chat/chat.router.test.ts:34-36`:

```ts
  getStatus(): AgentStatusPayload {
    return { status: "ready", model: { name: "fake", quantization: "q4" }, hardwareTier: "low", recovering: false };
  }
```

Y en `apps/backend/src/chat/chat.router.test.ts:231`:

```ts
  getStatus: () => ({ status: "ready", model: { name: "fake", quantization: "none" }, hardwareTier: "low", recovering: false }),
```

- [ ] **Step 6: Correr toda la suite de backend y verificar que no rompió nada**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npm run test --workspace=apps/backend
```

Esperado: mismo número de tests en verde que la foto del "antes" (Tarea 0, Step 4)
más 1 (el test nuevo). Cero fallas nuevas. Adicionalmente, correr el chequeo de
tipos completo (`vitest` no atrapa todos los errores de tipo si algo queda sin usar
en un archivo que ningún test importa):

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npx tsc --noEmit -p apps/backend/tsconfig.json
```

Esperado: sin errores.

- [ ] **Step 7: Commit**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && git add apps/backend/src/ai/orchestrator/agentService.ts apps/backend/src/ai/orchestrator/agentService.test.ts apps/backend/src/chat/chat.router.test.ts && git commit -m "feat(backend): expose the resolved hardware tier in AgentStatusPayload"
```

---

## Task 2: Frontend — llevar el tier del backend al hook de estado del modelo

**Files:**
- Modify: `apps/frontend/src/lib/model-status-client.ts`
- Modify: `apps/frontend/src/hooks/use-model-status.ts:20-31,91-100`
- Create: `apps/frontend/src/lib/model-status-client.test.ts`

**Interfaces:**
- Consumes: el JSON de `GET /api/chat/status` (Tarea 1), que ahora incluye
  `hardwareTier: "low" | "medium" | "high"`.
- Produces: `useModelStatus()` devuelve un campo nuevo
  `hardwareTier?: ResourceTier` (mismo patrón opcional que `model`/`delegation`, que
  también son `undefined` hasta que la primera respuesta llega). Es lo que consume
  la Tarea 3 (`App.tsx` → `EnginePanel`).

### ⚖️ La decisión de este lab — tipos compartidos o mirroreados

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **Mirroreado** (recomendada, y la que ya usa este archivo hoy) | El front y el back se despliegan y versionan por separado; el front ya define su propio `ModelStatus`/`ModelInfo`/`DelegationInfo` sin importar nada de `apps/backend`. Un campo nuevo es una línea en cada lado, no una migración de arquitectura. | Si el equipo tuviera decenas de tipos compartidos y el desvío entre copias fuera un problema recurrente — no es el caso hoy (son 4 tipos chicos). |
| **Paquete `packages/shared-types`** | Cuando duplicar tipos genera bugs reales de desincronización, y ya hay infraestructura de build compartida entre workspaces. | Acá es la abstracción prematura que las reglas del proyecto piden evitar: se agregaría un paquete nuevo, su build, su referencia en dos `tsconfig.json`, para sincronizar **un campo**. |

**→ Mirroreado, igual que `ModelStatus`/`ModelInfo`/`DelegationInfo`.**
**Diferencia con el proyecto real:** ninguna — ya es la arquitectura real de este
repo (no hay una versión "de lab" de esta decisión).

- [ ] **Step 1: Escribir el test que falla — `fetchModelStatus()` debe parsear `hardwareTier`**

Crear `apps/frontend/src/lib/model-status-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModelStatus } from '@/lib/model-status-client'

describe('fetchModelStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses the hardware tier the backend resolved', async () => {
    const body = {
      status: 'ready',
      model: { name: 'fake', quantization: 'q4' },
      hardwareTier: 'medium',
      recovering: false,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))

    const result = await fetchModelStatus()

    expect(result.hardwareTier).toBe('medium')
  })

  it('rejects when the backend responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))

    await expect(fetchModelStatus()).rejects.toThrow('status check failed: 500')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npx vitest run --root apps/frontend src/lib/model-status-client.test.ts
```

Esperado: FALLA el primer caso — `result.hardwareTier` es `undefined` (el tipo
`ModelStatusResponse` no declara el campo, así que ni siquiera compila la
aserción: "Property 'hardwareTier' does not exist on type 'ModelStatusResponse'").
El segundo caso ya pasa hoy (es cobertura existente de comportamiento, no nueva) —
sirve para confirmar que el archivo nuevo no rompe nada al crearlo.

- [ ] **Step 3: Implementación mínima en `model-status-client.ts`**

```ts
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ModelInfo = { name: string; quantization: string }
export type ResourceTier = 'low' | 'medium' | 'high'
/** Present once known (after the model has loaded) - whether the chat model is running on a remote provider or locally. */
export type DelegationInfo = { isDelegated: boolean; providerPublicKey?: string }
export type ModelStatusResponse = {
  status: ModelStatus
  error?: string
  model: ModelInfo
  hardwareTier: ResourceTier
  delegation?: DelegationInfo
  recovering: boolean
}
```

(Solo se agregan las dos líneas de `ResourceTier` y `hardwareTier`; el resto del
archivo —las 3 funciones `fetch()`— no cambia.)

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npx vitest run --root apps/frontend src/lib/model-status-client.test.ts
```

Esperado: PASS, los 2 casos.

- [ ] **Step 5: Propagar el campo en `use-model-status.ts`**

En el `import` (línea 3-10), sumar `type ResourceTier` a la lista ya existente:

```ts
import {
  fetchModelStatus,
  triggerPreload,
  cancelPreload,
  type ModelStatus,
  type ModelInfo,
  type DelegationInfo,
  type ResourceTier,
} from '@/lib/model-status-client'
```

En el tipo de retorno de `useModelStatus` (línea 20-31), agregar junto a `model`:

```ts
export function useModelStatus(): {
  status: ModelStatus
  error?: string
  model?: ModelInfo
  hardwareTier?: ResourceTier
  delegation?: DelegationInfo
  recovering: boolean
  cancelled: boolean
  cancelLoad: () => void
  retryLoad: () => void
} {
```

Y en el `import` (línea 3-10), sumar `type ResourceTier` a la lista ya existente.

En el objeto que devuelve el hook (línea 91-100), agregar la misma línea que ya
existe para `model`:

```ts
  return {
    status: query.data?.status ?? 'idle',
    error: query.data?.error,
    model: query.data?.model,
    hardwareTier: query.data?.hardwareTier,
    delegation: query.data?.delegation,
    recovering: query.data?.recovering ?? false,
    cancelled,
    cancelLoad: () => cancelLoadMutation.mutate(),
    retryLoad,
  }
```

(La rama `query.isError` de las líneas 80-89 no necesita el campo — ahí no hay datos
del servidor todavía, igual que ya pasa con `model`, que tampoco aparece en esa
rama.)

- [ ] **Step 6: Correr toda la suite de frontend y el build**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npm run test --workspace=apps/frontend && npm run build --workspace=apps/frontend
```

Esperado: mismo número de tests en verde que el "antes" más 2 (el archivo nuevo), y
el build (`tsc -b && vite build`) sin errores de tipo.

- [ ] **Step 7: Commit**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && git add apps/frontend/src/lib/model-status-client.ts apps/frontend/src/lib/model-status-client.test.ts apps/frontend/src/hooks/use-model-status.ts && git commit -m "feat(frontend): thread the hardware tier through useModelStatus"
```

---

## Task 3: Frontend — mostrar el tier en el panel del motor

**Files:**
- Modify: `apps/frontend/src/components/engine-panel.tsx`
- Modify: `apps/frontend/src/App.tsx:26-34`

**Interfaces:**
- Consumes: `modelStatus.hardwareTier` (`ResourceTier | undefined`), producido por
  la Tarea 2.
- Produces: nada que otra tarea consuma — es la punta visible de la cadena.

### ⚖️ La decisión de este lab — verificación manual vs. test de componente

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **Verificar a mano en el navegador** (recomendada) | Es exactamente lo que ya hace este repo hoy: **cero** archivos `.test.tsx` existen, no hay `@testing-library/react` instalado, ningún otro componente (`Welcome`, el propio `EnginePanel`) tiene test de render. Sumar la librería para una fila de texto sería la única razón de instalarla en todo el repo. | Si el equipo decidiera empezar a testear componentes en serio — ahí se instala la librería una vez, para todos, no colgada de este cambio de una línea. |
| **Instalar `@testing-library/react` y testear el render de `EnginePanel`** | Da cobertura automática permanente de esta fila. | Es una dependencia nueva (contra la regla de "cero dependencias nuevas" de este plan) solo para no mirar la pantalla una vez. |

**→ Verificación manual en el navegador** (Step 4 de esta tarea), igual que se hizo
para las Tareas 5/6 de `ui-improvements` (`qvac-context/05-estado-y-progreso.md`,
sesión del 25/09).
**Diferencia con el proyecto real:** ninguna — la ausencia de tests de componentes
es una decisión ya tomada para todo el repo, no algo que este plan introduce.

- [ ] **Step 1: Agregar la fila al panel — `engine-panel.tsx`**

Importar el tipo nuevo junto al resto de tipos ya importados de
`model-status-client` (línea 6):

```ts
import type { DelegationInfo, ModelInfo, ModelStatus, ResourceTier } from '@/lib/model-status-client'
```

Agregar `hardwareTier` a `Props` (línea 9-17):

```ts
type Props = {
  model?: ModelInfo
  modelStatus: ModelStatus
  statusError?: string
  hardwareTier?: ResourceTier
  delegation?: DelegationInfo
  cancelled: boolean
  onCancelLoad: () => void
  onRetryLoad: () => void
}
```

Agregar la tabla de etiquetas junto a `STATUS_LABEL`/`STATUS_COLOR` (después de la
línea 30):

```ts
const HARDWARE_TIER_LABEL: Record<ResourceTier, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}
```

Actualizar la firma de la función (línea 38) para recibir `hardwareTier`, y agregar
la fila en la sección "Chat model" (línea 93-96), arriba de "Name" — el tier es la
causa, el modelo es la consecuencia, en ese orden se lee mejor:

```ts
export function EnginePanel({ model, modelStatus, statusError, hardwareTier, delegation, cancelled, onCancelLoad, onRetryLoad }: Props) {
```

```ts
      <Section title="Chat model">
        <Kv label="Hardware tier" value={hardwareTier ? HARDWARE_TIER_LABEL[hardwareTier] : '—'} />
        <Kv label="Name" value={model?.name ?? '—'} />
        <Kv label="Quantization" value={model?.quantization ?? '—'} />
      </Section>
```

- [ ] **Step 2: Pasar el dato desde `App.tsx`**

En `apps/frontend/src/App.tsx:26-34`, agregar la prop junto a `model`:

```tsx
            <EnginePanel
              model={modelStatus.model}
              modelStatus={modelStatus.status}
              statusError={modelStatus.error}
              hardwareTier={modelStatus.hardwareTier}
              delegation={modelStatus.delegation}
              cancelled={modelStatus.cancelled}
              onCancelLoad={modelStatus.cancelLoad}
              onRetryLoad={modelStatus.retryLoad}
            />
```

- [ ] **Step 3: Chequeo de tipos y suite completa**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && npm run build --workspace=apps/frontend && npm run test --workspace=apps/frontend && npm run lint --workspace=apps/frontend
```

Esperado: build sin errores, tests igual que el "antes" (esta tarea no agrega
tests — ver la caja ⚖️ de arriba), lint sin avisos nuevos.

- [ ] **Step 4: Verificar en el navegador**

Arrancar el backend y el front (`npm run dev:server` en una terminal, `npm run
dev:client` en otra — no usar `preview_start` en esta carpeta de `Documents`, el
repo ya tiene registrado que falla con `EPERM uv_cwd` ahí; levantar por terminal y
enganchar el navegador integrado por URL, como en la sesión del 28/09 noche).
Recargar la página, esperar a que el modelo cargue ("Running locally"), y confirmar
en el panel izquierdo, sección "Chat model": aparece una fila "Hardware tier" con
"Low", "Medium" o "High" (según la máquina donde se corra), arriba de "Name". Sacar
una captura si hace falta dejar evidencia en `qvac-lab/verificacion/` (opcional,
como en tareas anteriores del repo).

- [ ] **Step 5: Comparación final "antes vs. después"**

Confirmar que el número de tests en verde de backend y frontend coincide con la
foto de la Tarea 0 más los 3 tests nuevos (Tarea 1: +1, Tarea 2: +2, Tarea 3: +0), y
que no hay ninguna fila `✓ → ✗` respecto del "antes".

- [ ] **Step 6: Commit**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916/.claude/worktrees/hardware-tier-ui && git add apps/frontend/src/components/engine-panel.tsx apps/frontend/src/App.tsx && git commit -m "feat(frontend): show the hardware tier in the engine panel"
```

**Sin hacer, a propósito (fuera de alcance de este plan):** abrir el PR — se le
pregunta a Lucas antes de tocar el remoto, como en toda tarea anterior de este repo.
Tampoco se tocan `models.config.test.ts` (agregar cobertura a
`LLM_MODELS_BY_TIER`/`WHISPER_MODELS_BY_TIER`/`TTS_MODELS_BY_TIER` es un hueco de
testing preexistente, no relacionado a mostrar el tier en la UI — si se quiere
cerrar, es un plan aparte). Tampoco se integra `getSystemResources()` del SDK para
detectar GPU real — la detección hoy es RAM/CPU vía `os`, y cambiar **cómo se
detecta** el hardware es una decisión de diseño distinta a **mostrar** lo que ya se
detecta, que es todo lo que pide este pedido.
