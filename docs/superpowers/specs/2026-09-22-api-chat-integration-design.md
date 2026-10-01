# Diseño: la API real de chat + TanStack Query en el front

**Fecha:** 22/09/2026
**Autor:** Lucas Rohr (con Claude)
**Rama:** `feat/frontend-chat`
**Estado:** aprobado en brainstorming, pendiente de plan de implementación

## Contexto

El front (`apps/frontend`) le habla hoy directo a LM Studio (`vite.config.ts`,
`DESTINO = MOTOR.lmStudio`) — el backend real (`apps/backend`) no participa en el
chat para nada. Después del merge de `main` del 22/09, el backend ya tiene dos
piezas funcionando pero **sin conectar entre sí ni con el front**:

- `ModelManagementService` (Valentina) — ciclo de vida de modelos QVAC, ya
  expuesto por HTTP en `/api/models/*`.
- `AgentService` (Ernesto) — un orquestador LangGraph que recibe un texto y
  devuelve una respuesta completa (`invoke(input: string): Promise<string>`),
  usado hoy solo desde un script de demo por consola (`ai/demo.ts`).

**Objetivo de este ciclo:** que el front hable con el backend real (no con LM
Studio), que al abrir la app se cargue el modelo con estado visible, y que se
pueda preguntar algo por chat y recibir una respuesta real del orquestador.
De paso, introducir TanStack Query en el front — pedido explícito de Lucas
para aprender la librería sobre un caso real.

## Decisiones de diseño (con el porqué)

### 1. La API es la única puerta (Camino A)

El front nunca llama a `/api/models/*` directamente. Todo pasa por endpoints
nuevos, propios de esta feature, que por dentro usan `AgentService` (que a su
vez ya usa `ModelManagementService`).

**Alternativa descartada:** que el front maneje el ciclo de vida del modelo
llamando directo a `/api/models/load` y guardando el `modelId`. Se descarta
porque rompe la compatibilidad con el formato OpenAI que el front ya habla
(el ticket de Lucas es justamente "OpenAI-Compatible Local API"), y porque
mete en el front una decisión (qué modelo, de dónde) que hoy vive en
`agentService.config.ts` según la RAM de la máquina.

### 2. La API siempre habla SSE (streaming), incluso hoy que no hay streaming real

`AgentService.invoke()` devuelve el texto completo de una sola vez — no hay
manera de que entregue pedacitos hoy. En vez de que el front tenga dos modos
(uno para respuesta completa, otro para streaming), la API **siempre**
contesta en formato SSE. Hoy manda un solo pedacito con todo el texto adentro
y un evento de cierre; el día que el orquestador entregue tokens de a uno,
la API va a mandar muchos pedacitos — **el front no cambia una línea**, porque
ya está escrito esperando SSE (`chat-client.ts`, ya existente).

**Alternativa descartada:** esperar a que el orquestador soporte streaming de
verdad antes de arrancar. Bloquea todo el ciclo de hoy por una dependencia que
no es tuya.

### 3. Carga del modelo: al abrir el front, con estado visible vía TanStack Query

`AgentService.preload()` ya existe y es perezoso/idempotente (`ensureModel()`
cachea la promesa). Se agrega un estado explícito (`idle`/`loading`/`ready`/
`error`) para que un endpoint de status tenga algo real que contestar, y el
front dispara la carga apenas monta, mostrando el progreso en el panel
derecho (hoy con datos fake).

**Alternativas descartadas:** cargar el modelo al arrancar el servidor Express
(sin front, sin manera de ver el progreso, y el servidor "parece colgado"
varios minutos la primera vez que hay que descargar el modelo); o no hacer
nada y dejar que cargue solo en la primera pregunta (esa pregunta tarda todo
lo que tarda la descarga+carga+inferencia sin ninguna explicación visible).

### 4. Historial de conversación: sí, desde el día uno

Acordado con Ernesto por Slack (22/09): `invoke()` pasa a aceptar
`{ role: 'user' | 'assistant'; content: string }[]` en vez de un string
suelto. Lucas lo modifica él mismo en `agentService.ts` (Ernesto ya dio el
visto bueno). La API **no manda `system` messages** — el prompt del sistema y
el recorte de la ventana de contexto quedan del lado de Ernesto
(`graph.ts`), como quedó explícito en el hilo.

### 5. Alcance de TanStack Query: el ciclo de vida del pedido, no el contenido que llega

TanStack Query (`useQuery`/`useMutation`) envuelve **el estado del modelo**
(status + preload) y **el envío del mensaje** (como `useMutation`, para tener
un solo patrón consistente de "pedirle algo al servidor" en toda la app, en
vez de dos: uno a mano con `AbortController` y otro con TanStack).

Lo que TanStack **no** maneja es el contenido que llega de a pedacitos: la
`mutationFn` de enviar un mensaje sigue leyendo el `ReadableStream` a mano
(la misma lógica que ya existe en `runTurn`, sin reescribir) y empujando cada
pedacito a Zustand. La caché de TanStack Query no está pensada para "un valor
que se arma de a poco" — forzarlo ahí sería más código, no menos.

### 6. HTTP client: `fetch` nativo en todo, sin Axios

Las guidelines de React de la empresa
(https://spaceuy.github.io/react-guidelines/) prefieren Axios sobre `fetch`
nativo para pedidos simples, por sus interceptores (útiles para auth y
manejo global de errores). Se decide **no** usarlo acá: el endpoint de
`/v1/chat/completions` necesita leer un `ReadableStream` de a pedacitos, algo
que el adaptador de Axios para navegador no expone bien — solo `fetch` lo
hace de forma directa. Sumarle Axios a los otros dos endpoints (status,
preload) para "cumplir la guideline a medias" agregaría una dependencia
nueva sin ganar nada real, porque este proyecto no tiene login ni tokens que
un interceptor pudiera centralizar. Se anota como desvío consciente de la
guideline, con el motivo.

### 7. Estructura de carpetas: se mantiene la convención actual del repo (por tipo)

Las guidelines piden organizar "por feature, no por tipo". El repo hoy
organiza por tipo (`hooks/`, `lib/`, `components/`), y **todo** lo que Lucas
escribió hasta ahora sigue ese patrón. Migrar a carpetas por feature solo para
esta tarea dejaría dos convenciones conviviendo sin necesidad — se prioriza
la consistencia con el código ya existente en este repo (regla general:
seguir el patrón establecido antes que una guideline genérica) sobre cumplir
la guideline al pie de la letra. Los archivos nuevos entran junto a los que
ya existen, con el mismo estilo de nombres.

### 8. Testing: pendiente, no bloquea este ciclo

El front no tiene Vitest instalado ni un solo test hoy, pese a que las
guidelines piden 80% de cobertura por rama. Bootstrapear testing (config,
setup, primeros tests) es un trabajo aparte de conectar el chat real. Queda
anotado como tarea siguiente explícita, no mezclada con este plan.

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│  FRONT (React + Vite, :5173)                         │
│  useModelStatus() ──TanStack Query──▶ /api/chat/*    │
│  useChat()        ──TanStack Query──▶ /v1/chat/*     │
└───────────────────────┬───────────────────────────────┘
                         │ fetch, mismo origen (proxy de Vite)
┌───────────────────────▼───────────────────────────────┐
│  API (Express, :3001)                                │
│  chat.router.ts:                                     │
│    GET  /api/chat/status                             │
│    POST /api/chat/preload                            │
│    POST /v1/chat/completions   (SSE, formato OpenAI)  │
└───────────────────────┬───────────────────────────────┘
                         │ una función (mismo proceso)
┌───────────────────────▼───────────────────────────────┐
│  AgentService (Ernesto, modificado por Lucas)        │
│  · preload() → status idle→loading→ready/error       │
│  · invoke(messages[]) → texto completo                │
│  Adentro: LangGraph + ChatQVAC + ModelManagementService│
└─────────────────────────────────────────────────────────┘
```

## Flujo de datos, de punta a punta

**Al abrir la app:**

```
1. App monta
2. useModelStatus(): useQuery(['model-status'], fetchStatus)
   GET /api/chat/status → { status: 'idle' }
3. status === 'idle' → useMutation(triggerPreload).mutate()
   POST /api/chat/preload → dispara agentService.preload() (no espera)
4. refetchInterval: 1000ms MIENTRAS status sea 'idle' o 'loading'
   GET /api/chat/status → { status: 'loading' } (se repite solo)
5. Termina de cargar en RAM
   GET /api/chat/status → { status: 'ready' }
   → refetchInterval se apaga solo
   → composer.tsx se habilita
```

**Al mandar un mensaje:**

```
6. Usuario escribe y envía
7. useChat().sendMessage() → useMutation.mutate()
   mutationFn = runTurn(...) → fetch POST /v1/chat/completions
   body: { model, messages: [...historial completo...], stream: true }
8. chat.router.ts valida el body, arma { role, content }[]
   (filtra cualquier 'system' que se colara — la API no manda system)
   → agentService.invoke(messages)
9. AgentService → LangGraph → ChatQVAC → QVAC (modelo ya en RAM)
   tarda ~10-30s con Qwen3-600M, sin pedacitos intermedios
10. chat.router.ts manda UN pedacito SSE con el texto completo
    + un evento de cierre (choices[0].finish_reason: 'stop')
11. chat-client.ts (sin cambios) lo procesa como si fuera streaming real
    → Zustand actualiza el mensaje → React lo pinta
```

## Contratos HTTP

### `GET /api/chat/status`

```jsonc
// 200
{ "status": "idle" | "loading" | "ready" | "error", "error"?: string }
```

### `POST /api/chat/preload`

Sin body. Idempotente: si ya está `loading` o `ready`, no dispara una carga
nueva — devuelve el status actual tal cual está.

```jsonc
// 202 (aceptado, no espera a que termine) — status DESPUÉS de procesar esta
// llamada: 'idle' pasa a 'loading' (recién disparado); si ya era 'loading' o
// 'ready', se devuelve tal cual, sin disparar nada de nuevo
{ "status": "loading" | "ready" }
// 500 solo si el disparo mismo falla (no la carga en background, esa se ve por /status)
{ "error": "could not start preload" }
```

### `POST /v1/chat/completions`

Formato OpenAI, igual al que ya arma `chat-client.ts`:

```jsonc
// request
{
  "model": "qwen3-600m-inst-q4",
  "messages": [{ "role": "user" | "assistant", "content": "..." }],
  "stream": true
}
```

Respuesta: `text/event-stream`, un chunk con el texto completo y un chunk
final:

```
data: {"choices":[{"delta":{"content":"...la respuesta completa..."}}]}

data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

Si el modelo no está `ready` todavía: `503` con
`{ "error": "model not ready" }` — el front no debería llegar a mandar esto
porque el composer está deshabilitado, pero la API lo valida igual.

## Archivos

### Backend (`apps/backend/src/`)

| Archivo | Acción | Qué hace |
|---|---|---|
| `chat/chat.router.ts` | crear | Las 3 rutas: `GET /status`, `POST /preload`, `POST /completions` |
| `chat/chat.router.helpers.ts` | crear | Parseo/validación del body, armado de chunks SSE en formato OpenAI |
| `chat/chat.router.const.ts` | crear | Headers de SSE, mensajes de error |
| `ai/orchestrator/agentService.ts` | modificar | `invoke()` acepta array de mensajes; se agrega estado `idle/loading/ready/error` actualizado por `preload()` |
| `server.ts` | modificar | Crea `AgentService` una vez, reusando el `ModelManagementService` existente; monta los routers nuevos |

### Frontend (`apps/frontend/src/`)

| Archivo | Acción | Qué hace |
|---|---|---|
| `lib/query-client.ts` | crear | Instancia única de `QueryClient` |
| `hooks/use-model-status.ts` | crear | `useQuery` de status (con `refetchInterval` condicional) + `useMutation` de preload |
| `lib/model-status-client.ts` | crear | `fetch` tipados a `/api/chat/status` y `/api/chat/preload` |
| `hooks/use-chat.ts` | modificar | `sendMessage` dispara un `useMutation` cuya `mutationFn` es la `runTurn` ya existente |
| `main.tsx` | modificar | Envuelve `<App />` en `<QueryClientProvider>` |
| `App.tsx` | modificar | El panel derecho recibe el status real (solo la sección "Inferencia"); el resto sigue con `FAKE_ENGINE_STATE` |
| `components/composer.tsx` | modificar | Se deshabilita mientras el status no sea `ready`, con el motivo visible (accesibilidad) |
| `vite.config.ts` | modificar | `DESTINO = MOTOR.backend`; se agrega proxy para `/api` (status/preload solo existen en el backend propio) |
| `package.json` | modificar | Se agrega `@tanstack/react-query` |

## Manejo de errores

Mismo patrón que ya usa `models.router.helpers.ts`: un tipo de error con
"etapa", se loguea el error real server-side, y al cliente **solo** un
mensaje genérico — nunca el detalle interno del SDK. Si `/preload` falla,
`status` pasa a `'error'` con un mensaje corto y el panel derecho lo muestra
en vez de "Cargando…". Si `/completions` falla a mitad de camino, se manda
un pedacito de error por SSE y el front lo procesa con `responseFailed`
(ya existente en `chat-store.ts`).

## Fuera de alcance (anotado, no oculto)

- **Streaming real** (tokens de a uno): depende de que Ernesto cambie
  `AgentService`/`ChatQVAC` para entregar pedacitos. El diseño de hoy ya lo
  soporta sin cambios del lado del front cuando eso pase.
- **Historial con memoria real de largo plazo / recorte de contexto:**
  del lado de Ernesto, ya acordado.
- **Panel derecho completo con datos reales** (CPU, RAM, velocidad,
  nombre exacto del modelo cargado): necesita endpoints que no existen
  todavía. Solo la sección "Inferencia" (idle/loading/ready/error) se
  vuelve real en este ciclo.
- **Testing** (Vitest + React Testing Library en el front): tarea aparte,
  explícitamente pospuesta.
- **Modelo real a usar:** `agentService.config.ts` carga
  `QWEN3_600M_INST_Q4` en las dos ramas de recursos (baja y alta), aunque
  Valentina anunció `Qwen3.5-4B` como el modelo elegido para máquinas con
  recursos. Puede ser intencional (más rápido para desarrollar) o quedar
  pendiente — vale confirmarlo con el equipo, no se toca en este plan.

## Preguntas ya resueltas con el equipo (Slack, 22/09)

- Ernesto: `invoke()` acepta `{ role, content }[]`, sin `SystemMessage` de
  parte de la API, y él se encarga del recorte de contexto.
