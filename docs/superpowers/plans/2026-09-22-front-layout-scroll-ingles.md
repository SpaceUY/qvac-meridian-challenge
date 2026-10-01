# Front: layout fijo, autoscroll y código en inglés — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la pantalla del chat se comporte como Claude —sidebars quietos, conversación que se sigue sola, composer flotante con fade— y que todo el código del front quede escrito en inglés.

**Architecture:** El front es una sola pantalla de tres columnas (`AppShell`). Hoy la columna del medio no tiene caja de scroll propia, así que crece hacia abajo y hace scrollear el documento entero, arrastrando los sidebars. El arreglo es estructural, no cosmético: se le pone al centro un contenedor de scroll real (`min-h-0` + `overflow-y-auto`), se saca el composer del flujo normal para que flote encima con un degradado, y se agrega un hook chico (`useStickToBottom`) que mantiene la vista pegada al fondo mientras llegan tokens **salvo** que el usuario haya scrolleado para arriba.

**Tech Stack:** React 19.2 · TypeScript 6.0 (strict) · Vite 8.3 · Tailwind CSS 4.3 · shadcn/radix-ui · lucide-react · oxlint. **Sin dependencias nuevas.**

**Spec:** no hay documento de spec aparte. El pedido, textual, es este:

> * los side bars no se quedan fijos al hacer scroll hacia abajo
> * a medida que la conversacion crece y no cabe en la pantalla del medio, que la misma en vez de mostrar la conversacion cortada y obligar al user que haga scroll, que se haga scroll automaticamente para que se pueda leer de manera fluida. Caso borde: si la respuesta viene muy larga y no cabe, que el usuario haga scroll para seguir leyendo
> * La barra para mandar mensajes debe estar fija como en claude, y con ese mini fading que tiene en su padding superior
> * El codigo debe estar escrito en ingles

Decisiones tomadas con Lucas antes de escribir el plan:
- **Inglés = identificadores + comentarios.** Todo el código, incluidos los comentarios explicativos largos.
- **Sí al botón flotante ↓** para volver al fondo cuando el autoscroll está desenganchado.

## Global Constraints

- **Monorepo npm workspaces** (no pnpm). Todo se corre desde la raíz `qvac-practice-0916/`.
- **Cero dependencias nuevas.** Todo sale de lo ya instalado (React, Tailwind, radix-ui, lucide-react).
- **Versiones exactas ya instaladas** (no tocar `package.json`): react `^19.2.8`, tailwindcss `^4.3.3`, vite `^8.3.0`, typescript `~6.0.2`, radix-ui `^1.6.7`, lucide-react `^1.47.0`.
- **TypeScript strict** (`tsconfig.app.json`). El type-check es parte de `npm run build:client`.
- **Código en inglés**: nombres de archivo, tipos, variables, props, acciones del reducer y comentarios.
- **El texto que ve el usuario queda en español** por ahora ("Corpus", "Pregunta lo que quieras", aria-labels). No es código. Ver "Pregunta abierta" al final.
- **Branch:** `feat/frontend-chat` (el actual). Conventional commits, un commit por task.
- **Motor de desarrollo:** LM Studio en `http://127.0.0.1:1234` con `llama-3.2-3b-instruct` cargado. Verificado el 22/09 con `curl localhost:1234/v1/models`. El proxy de `vite.config.ts` ya apunta ahí.

## Estrategia de verificación (desviación consciente del TDD)

**Este repo no tiene test runner** (`npm test` en la raíz es un `exit 1`; no hay vitest ni jsdom en ningún workspace). Los cuatro arreglos son de layout y de scroll: lo que hay que comprobar es *dónde quedan los píxeles* y *si la vista sigue al texto*, algo que un test de jsdom no puede ver (jsdom no hace layout: `scrollHeight` da 0 siempre).

Por eso **cada task se verifica a mano en el navegador, con pasos y resultado esperado explícitos**, más el type-check (`npm run build:client`) y el linter (`npm run lint --workspace=apps/frontend`). Montar Vitest + jsdom solo para esto costaría más que las cuatro tareas juntas y no cubriría lo que importa.

**Diferencia con el proyecto real:** ahí sí corresponde Vitest + Testing Library para la lógica (reducer, parser SSE) y Playwright para el scroll, que corre en un navegador de verdad y sí mide layout.

## Estructura de archivos

Después de este plan, `apps/frontend/src/` queda así:

| Archivo | Responsabilidad | Estado |
|---|---|---|
| `App.tsx` | Cableado: arma el shell con los tres paneles. | Modificado |
| `components/app-shell.tsx` | Chasis: header + tres columnas, y el alto fijo de la pantalla. | Modificado |
| `components/chat-panel.tsx` | La columna del medio: caja de scroll + composer flotante + botón ↓. | **Nuevo** |
| `components/message-list.tsx` | Solo la lista de burbujas. No sabe de scroll. | Renombrado desde `lista-mensajes.tsx` |
| `components/composer.tsx` | Solo el input y sus dos botones. No sabe dónde está parado. | Modificado |
| `components/corpus-panel.tsx` | Panel izquierdo. | Modificado (rename) |
| `components/engine-panel.tsx` | Panel derecho. | Renombrado desde `motor-panel.tsx` |
| `hooks/use-chat.ts` | El turno de conversación. | Modificado (rename) |
| `hooks/use-stick-to-bottom.ts` | Mantener la vista pegada al fondo, y soltarla si el usuario scrollea. | **Nuevo** |
| `hooks/use-element-height.ts` | Medir cuánto mide el composer (para el espaciador de abajo). | **Nuevo** |
| `hooks/use-mirror-ref.ts` | Un ref que siempre tiene el último valor. Lo usan dos hooks. | **Nuevo** (extraído de `use-chat.ts`) |
| `lib/chat-types.ts` · `chat-reducer.ts` · `chat-client.ts` · `parse-sse.ts` · `config.ts` · `fake-data.ts` | Tipos, reglas, transporte. | Modificados (rename) |
| `App.css`, `assets/hero.png`, `assets/react.svg` | Sobras de la plantilla de Vite, no las importa nadie. | **Borrados** |

**Por qué `chat-panel.tsx` aparte y no todo dentro de `App.tsx`:** la columna del medio deja de ser "dos componentes apilados" y pasa a tener estado propio (dónde está el scroll, cuánto mide el composer). Ese estado no le importa a nadie más. Si vive en `App.tsx`, `App.tsx` deja de ser un archivo de cableado y se vuelve el archivo más complicado del proyecto.

---

## Task 1: Todo el código en inglés (+ borrar las sobras de la plantilla)

**Por qué va primero:** las tasks 2, 3 y 4 reescriben varias de estas mismas líneas. Si el rename va al final, se escribe dos veces lo mismo y el diff final mezcla "moví esto de lugar" con "le cambié el nombre" — el peor diff posible para revisar.

**Aclaración honesta sobre esta task:** es la más larga en cantidad de archivos y la más aburrida. No hay ninguna decisión de diseño escondida: es traducción mecánica. El type-check recién se pone en verde en el **Step 8**; entre medio va a estar en rojo y está bien.

⚖️ **La decisión de este lab — ¿cómo se traduce un tipo con dos niveles del mismo nombre?**

Hoy el tipo es `FaseMensaje` y el campo también se llama `fase`, así que el código dice `mensaje.fase.fase === 'escribiendo'`. Al traducir hay tres caminos:

| Opción | Queda | Conviene cuando | No conviene cuando |
|---|---|---|---|
| Repetir el nombre: `status.status` | `m.status.status === 'streaming'` | Nunca, la verdad. Es fiel al original pero el original ya era confuso. | Siempre: el lector duda si escribió dos veces por error. |
| **Union con tag `type`** ← elegida | `m.status.type === 'streaming'` | El estado trae datos extra según el caso (el `error` trae un `reason`, los otros no). TypeScript te obliga a chequear el caso antes de leer `reason`. | El estado es un enum pelado sin datos asociados: ahí el objeto es puro ruido. |
| Aplanar: `status: 'streaming' \| 'done' \| 'error'` + `error?: string` | `m.status === 'error' && m.error` | Estados simples sin datos, o cuando el objeto va a viajar por la red. | Acá: se puede escribir `status: 'done'` con un `error` colgado. El tipo deja de impedir estados imposibles. |

**Diferencia con el proyecto real:** igual. Las uniones discriminadas ya son la convención de TypeScript en SpaceDev (ver la skill `backend:typescript`).

**Files:**
- Modify: `apps/frontend/src/lib/chat-types.ts`, `chat-reducer.ts`, `chat-client.ts`, `parse-sse.ts`, `config.ts`, `fake-data.ts`
- Modify: `apps/frontend/src/hooks/use-chat.ts`
- Modify: `apps/frontend/src/components/composer.tsx`, `corpus-panel.tsx`, `app-shell.tsx`, `App.tsx`
- Rename: `components/lista-mensajes.tsx` → `components/message-list.tsx`; `components/motor-panel.tsx` → `components/engine-panel.tsx`
- Modify: `apps/frontend/.env.example`
- Delete: `apps/frontend/src/App.css`, `apps/frontend/src/assets/hero.png`, `apps/frontend/src/assets/react.svg`

**Interfaces:**
- Consumes: nada (es la primera task).
- Produces: los nombres en inglés que usan TODAS las tasks siguientes. Los que importan: `type Message = { id, role, text, citations, status }`, `type History = Message[]`, `useChat()` devuelve `{ history, sendMessage, stop, isStreaming, isWaitingForFirstChunk }`, `<MessageList history={...} />`, `<Composer isStreaming onSend onStop />`, `<AppShell leftSidebar children rightSidebar />`.

- [ ] **Step 1: Traducir `lib/chat-types.ts`** — es el único archivo donde además cambia la forma del tipo, así que va completo:

```ts
// The chat types. They live apart from the reducer and the hook so that a
// component that only needs to know "what shape a Message has" does not have
// to drag in the logic of how the state changes.

export type Role = 'user' | 'assistant'

export type Citation = {
  file: string
  score?: number
}

/**
 * Where a message is in its life. A discriminated union: `type` is the tag
 * TypeScript reads to know which of the three shapes it is holding, and only
 * the 'error' one carries a reason. That is the point — you cannot read
 * `reason` without first proving the message actually failed.
 */
export type MessageStatus =
  | { type: 'streaming' }
  | { type: 'done' }
  | { type: 'error'; reason: string }

export type Message = {
  id: string
  role: Role
  text: string
  citations: Citation[]
  status: MessageStatus
}

/**
 * The conversation: the list of messages, in order.
 *
 * It is the bare array, with no wrapper. It used to be { messages: Message[] },
 * but the wrapper held nothing else and forced `{ ...state, messages: ... }` in
 * every branch of the reducer. If some day something else needs to live next to
 * the conversation, we wrap it again.
 */
export type History = Message[]

export type ChatAction =
  | { type: 'TURN_STARTED'; userMessageId: string; assistantMessageId: string; text: string }
  | { type: 'CHUNK_RECEIVED'; id: string; delta: string }
  | { type: 'CITATIONS_RECEIVED'; id: string; citations: Citation[] }
  | { type: 'RESPONSE_FINISHED'; id: string }
  | { type: 'RESPONSE_FAILED'; id: string; reason: string }
```

- [ ] **Step 2: Traducir `lib/chat-reducer.ts`** con esta tabla. La lógica no cambia ni una línea: solo nombres, comentarios y los `case` del switch (que ya quedaron definidos en el Step 1).

| Antes | Después |
|---|---|
| `HISTORIAL_INICIAL` | `INITIAL_HISTORY` |
| `chatReducer(historial, accion)` | `chatReducer(history, action)` |
| `crearMensaje(id, rol, texto, fase)` | `createMessage(id, role, text, status)` |
| `conMensaje(historial, id, cambiar)` | `withMessage(history, id, change)` |
| `estaEsperandoPrimerPedazo` | `isWaitingForFirstChunk` |
| `estaRespondiendo` | `isStreaming` |
| `m.texto` / `m.citas` / `m.fase` | `m.text` / `m.citations` / `m.status` |
| `{ fase: 'listo' }` / `{ fase: 'escribiendo' }` | `{ type: 'done' }` / `{ type: 'streaming' }` |
| `ultimo` | `last` |

- [ ] **Step 3: Traducir `lib/chat-client.ts`**

| Antes | Después |
|---|---|
| `MensajeOpenAI` | `OpenAIMessage` |
| `DeltaChat = { texto?, citas? }` | `ChatDelta = { text?, citations? }` |
| `aMensajesOpenAI` | `toOpenAIMessages` |
| `ErrorDeMotor` (y su `this.name`) | `EngineError` (y `this.name = 'EngineError'`) |
| `pedirCompletion({ mensajes, sessionId, signal })` | `requestCompletion({ messages, sessionId, signal })` |
| `type PedidoCompletion` | `type CompletionRequest` |
| `leerDeltas` | `readDeltas` |
| `interpretarChunk` / `primera` | `parseChunk` / `first` |
| `parsearJsonSeguro` / `esObjeto` / `esCita` | `safeJsonParse` / `isObject` / `isCitation` |
| `'el servidor respondio N'` | `` `the server responded ${res.status}` `` |
| `'el servidor respondio sin cuerpo'` | `'the server responded with no body'` |

⚠️ **Lo que NO se traduce en este archivo:** `role`, `content`, `choices`, `delta`, `citations`, `model`, `messages`, `stream`. Son los nombres del **formato OpenAI que viaja por la red**; cambiarlos rompe la comunicación con LM Studio. Ya están en inglés, pero la regla vale para el futuro: el wire format no se renombra nunca por gusto.

- [ ] **Step 4: Traducir `lib/parse-sse.ts`**

| Antes | Después |
|---|---|
| `leerEventosSSE` | `readSSEEvents` |
| `SEPARADOR_EVENTO` / `SEPARADOR_LINEA` / `PREFIJO_DATOS` | `EVENT_SEPARATOR` / `LINE_SEPARATOR` / `DATA_PREFIX` |
| `lector` / `decodificador` | `reader` / `decoder` |
| `cortarEventos` → `{ completos, aMedias }` | `splitEvents` → `{ complete, partial }` |
| `extraerDatos(bloque)` | `extractData(block)` |
| `lineas` / `linea` / `trozos` / `datos` | `lines` / `line` / `chunks` / `data` |

- [ ] **Step 5: Traducir `lib/config.ts` y `.env.example`**

| Antes | Después |
|---|---|
| `CONFIG.endpointCompletions` | `CONFIG.completionsEndpoint` |
| `CONFIG.modelo` | `CONFIG.model` |
| `CONFIG.headerSesion` | `CONFIG.sessionHeader` |
| `VITE_MODELO` | `VITE_MODEL` |

El valor del header (`'X-Meridian-Session'`) y el default del modelo (`'llama-3.2-3b-instruct'`) **no cambian**: son contratos con el backend y con LM Studio. En `.env.example` hay que cambiar `VITE_MODELO=` por `VITE_MODEL=` y traducir los dos comentarios de arriba.

- [ ] **Step 6: Traducir `lib/fake-data.ts`**

| Antes | Después |
|---|---|
| `DocumentoCorpus = { archivo, pedazos }` | `CorpusDocument = { file, chunks }` |
| `CORPUS_FALSO` | `FAKE_CORPUS` |
| `ESTADO_MOTOR_FALSO` | `FAKE_ENGINE_STATE` |
| `modo: 'local' \| 'delegado'` | `mode: 'local' \| 'delegated'` |
| `modelo: { nombre, cuantizacion, contexto, tokensPorSeg }` | `model: { name, quantization, context, tokensPerSec }` |
| `embeddings: { nombre, dimension }` | `embeddings: { name, dimension }` |
| `equipo: { cpu, ramTotalGb, gpu }` | `machine: { cpu, totalRamGb, gpu }` |
| `ramUsadaGb` / `ramDisponibleGb` | `usedRamGb` / `availableRamGb` |
| `perfilElegido` | `selectedProfile` |

Los **valores** de string que se muestran en pantalla (`'3B / Q4 — elegido automaticamente...'`, los nombres de archivo del corpus) quedan en español: son contenido, no código.

- [ ] **Step 7: Traducir `hooks/use-chat.ts`**

| Antes | Después |
|---|---|
| `useEspejo` | `useMirrorRef` (en la Task 4 se muda a su propio archivo) |
| `historial` / `historialRef` | `history` / `historyRef` |
| `enviarMensaje(textoCrudo)` | `sendMessage(rawText)` |
| `detener` | `stop` |
| `respondiendo` (lo que devuelve) | `isStreaming` |
| `esperandoPrimerPedazo` | `isWaitingForFirstChunk` |
| `ejecutarTurno` / `aplicarDelta` | `runTurn` / `applyDelta` |
| `mensajesOpenAI` | `openAIMessages` |
| `idPregunta` / `idRespuesta` | `userMessageId` / `assistantMessageId` |
| `motivo` | `reason` |
| `'no se pudo conectar con el modelo'` | `'could not reach the model'` |

- [ ] **Step 8: Traducir y renombrar los componentes** (acá el type-check vuelve al verde)

```bash
cd apps/frontend/src/components
git mv lista-mensajes.tsx message-list.tsx
git mv motor-panel.tsx engine-panel.tsx
```

| Archivo | Antes | Después |
|---|---|---|
| `message-list.tsx` | `ListaMensajes({ historial })` | `MessageList({ history })` |
| | `Burbuja` / `mensaje` | `MessageBubble` / `message` |
| | `esUsuario` / `pensando` | `isUser` / `isThinking` |
| | `PuntosPensando` / `Cursor` | `ThinkingDots` / `Cursor` |
| | `Citas({ citas })` / `cita` | `CitationList({ citations })` / `citation` |
| | `mensaje.fase.fase === 'escribiendo'` | `message.status.type === 'streaming'` |
| | `mensaje.fase.motivo` | `message.status.reason` |
| `engine-panel.tsx` | `MotorPanel({ estado })` / `EstadoMotor` | `EnginePanel({ state })` / `EngineState` |
| | `porcentajeRam` | `ramPercent` |
| | `Seccion({ titulo })` | `Section({ title })` |
| | `Kv({ etiqueta, valor })` | `Kv({ label, value })` |
| `corpus-panel.tsx` | `CorpusPanel({ documentos })` / `doc.archivo` / `doc.pedazos` | `CorpusPanel({ documents })` / `doc.file` / `doc.chunks` |
| | `totalPedazos` | `totalChunks` |
| `composer.tsx` | props `respondiendo` / `onEnviar` / `onDetener` | `isStreaming` / `onSend` / `onStop` |
| | `texto` / `setTexto` / `enviar` | `text` / `setText` / `send` |
| | `alPresionarTecla` | `handleKeyDown` |
| `app-shell.tsx` | props `sidebarIzquierda` / `sidebarDerecha` | `leftSidebar` / `rightSidebar` |
| | `ANCHO_MINIMO_CHAT` / `ANCHO_PANEL_IZQ` / `ANCHO_PANEL_DER` | `MIN_CHAT_WIDTH` / `LEFT_PANEL_WIDTH` / `RIGHT_PANEL_WIDTH` |
| | `cabenLosDos` / `cabeUno` / `anchoVentana` | `bothFit` / `oneFits` / `windowWidth` |
| | `izqAbierta` / `derAbierta` | `leftOpen` / `rightOpen` |
| `App.tsx` | importa y cablea todo lo anterior | idem, con los nombres nuevos |

- [ ] **Step 9: Borrar las sobras de la plantilla de Vite**

Primero comprobar que de verdad no las usa nadie (si esto imprime algo, **no borrar** y avisar):

```bash
cd apps/frontend && grep -rn "App.css\|hero.png\|react.svg" src/ index.html
```

Si no imprime nada:

```bash
cd apps/frontend && git rm src/App.css src/assets/hero.png src/assets/react.svg
```

- [ ] **Step 10: Verificar que compila, que pasa el linter y que no quedó español suelto**

```bash
npm run build:client && npm run lint --workspace=apps/frontend
```
Esperado: build OK y `Found 0 warnings and 0 errors`.

```bash
grep -rniE "mensaje|historial|texto|citas|motor|pedazo|respondiendo|enviar|detener|archivo|estado|izquierda|derecha" apps/frontend/src --include=*.ts --include=*.tsx | grep -v "ui/"
```
Esperado: **solo** líneas de texto que ve el usuario (placeholders, aria-labels, el `selectedProfile` de `fake-data.ts`, los nombres de archivo del corpus). Ningún identificador. `ui/` se excluye porque es código generado por shadcn y ya está en inglés.

- [ ] **Step 11: Verificar a ojo que la app sigue igual**

```bash
npm run dev:client
```
Abrir `http://localhost:5173`, mandar "hola" y confirmar: llega la respuesta en streaming, el botón cuadrado corta, los dos paneles laterales muestran sus datos. Nada de esto cambió de comportamiento — si algo cambió, es un error de traducción.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "refactor(frontend): traducir todo el codigo del front a ingles

Identificadores, tipos, acciones del reducer, props y comentarios. El
formato OpenAI del wire y el texto que ve el usuario quedan como estaban.
Se borran App.css y los assets de la plantilla de Vite (sin usar).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Que los sidebars se queden quietos

**Qué se construye:** la cadena de alturas que hace que la pantalla mida exactamente lo que mide la ventana, y que el único que scrollea sea el centro.

**Por qué hace falta — el diagnóstico, que es lo importante:**

Hoy el shell ya dice `h-dvh` (alto = alto de la ventana) y los `aside` ya dicen `overflow-y-auto`. Uno miraría eso y diría "está bien". Y sin embargo el documento entero scrollea. El culpable es una regla de CSS que casi nadie conoce:

> Un hijo de un flex container tiene, por defecto, `min-height: auto`. Traducción: **se niega a ser más bajo que su contenido.**

Entonces pasa esto, en cadena:
1. La lista de mensajes crece (30 mensajes = 4000 px de contenido).
2. Su contenedor tiene `flex-1`, que dice "repartite el espacio sobrante"… pero `min-height: auto` dice "igual no bajo de 4000 px". Gana el segundo. **`flex-1` solo no crea una caja de scroll.**
3. `<main>` mide 4000 px, la fila de tres columnas mide 4000 px.
4. El `div` de arriba dice `h-dvh` (900 px) pero su contenido mide 4000 px y **se desborda hacia afuera**, porque nadie le dijo qué hacer con lo que sobra.
5. El navegador scrollea el documento entero. Los `aside` son parte del documento: se van para arriba con todo lo demás.

El `overflow-y-auto` de los `aside` nunca llegó a activarse, porque para que un `overflow` sirva la caja tiene que tener un alto **limitado** — y no lo tenía.

**El arreglo son tres clases:** `min-h-0` en cada eslabón de la cadena (para desarmar ese `min-height: auto`), `overflow-hidden` en la raíz (para que lo que sobre no empuje el documento) y `shrink-0` en el header (para que no se aplaste cuando el centro pide espacio).

⚖️ **La decisión de este lab — ¿quién es "la pantalla"?**

| Opción | Cómo se hace | Conviene cuando | No conviene cuando |
|---|---|---|---|
| **Alto fijo + cajas internas** ← elegida | `h-dvh` + `overflow-hidden` en la raíz; cada columna scrollea sola | Es una **app** de una sola pantalla: chat, editor, dashboard. El header y los paneles son mobiliario, no contenido. | Es una página larga para leer: un blog, un landing. Ahí el documento *debe* scrollear. |
| `position: sticky` en los sidebars | Que el documento scrollee y los paneles queden pegados arriba | Layout de dos columnas con contenido largo (una doc con índice al costado). No pelea con el scroll del navegador. | Acá: el composer abajo también tendría que quedar fijo, y ya no hay un "abajo" — la página no termina nunca. |
| `position: fixed` en los sidebars | Sacarlos del flujo y anclarlos a la ventana | Overlays, menús móviles, modales. | Hay que replicar a mano el ancho que ocupan (`margin-left: 208px` en el centro) y se desincroniza en cuanto los paneles se abren y cierran, como acá. |

**Diferencia con el proyecto real:** en el proyecto real este chasis probablemente sea el `<SidebarProvider>` de shadcn, que ya trae los paneles colapsables con atajo de teclado y persistencia en cookie. Acá se hace a mano porque el objetivo es entender *por qué* funciona, no cuánto se tarda.

**Files:**
- Modify: `apps/frontend/src/components/app-shell.tsx:42-66`
- Modify: `apps/frontend/src/components/message-list.tsx:1-17`

**Interfaces:**
- Consumes: `AppShell({ leftSidebar, children, rightSidebar })` y `MessageList({ history })`, de la Task 1.
- Produces: `<main>` queda como caja de alto **limitado** (`min-h-0`), lista para que la Task 3 le cuelgue el composer flotante con `absolute`. `MessageList` deja de scrollear por su cuenta: ahora solo dibuja la lista.

- [ ] **Step 1: Arreglar la cadena de alturas en `app-shell.tsx`**

Reemplazar el `return` entero (líneas 42-66) por esto. Los tres cambios están marcados:

```tsx
  return (
    // overflow-hidden: lo que no entre en la ventana se recorta acá adentro,
    // no empuja al documento. Es lo que impide que la pagina entera scrollee.
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* shrink-0: el header nunca se aplasta, aunque el centro pida espacio. */}
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={() => setLeftOpen((v) => !v)} aria-label="Corpus">
          <PanelLeft className="size-4" />
        </Button>
        <strong className="text-sm font-medium">Meridian Assistant</strong>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => setRightOpen((v) => !v)}
          aria-label="Estado del modelo"
        >
          <PanelRight className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen && <aside className="w-52 shrink-0 overflow-y-auto border-r p-3">{leftSidebar}</aside>}
        {/* min-h-0: sin esto, main se niega a medir menos que su contenido y
            toda la cadena de alturas se rompe. Ver el diagnostico del plan. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
        {rightOpen && <aside className="w-64 shrink-0 overflow-y-auto border-l p-3">{rightSidebar}</aside>}
      </div>
    </div>
  )
```

- [ ] **Step 2: Sacarle el scroll a `message-list.tsx`**

El `ScrollArea` de Radix se va. Reemplazar las líneas 1-17 por:

```tsx
import type { Citation, History, Message } from '@/lib/chat-types'

type Props = { history: History }

/** The whole conversation, one bubble per message. Req. [2.4] + [6.1.2]. */
export function MessageList({ history }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      {history.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}
```

**Por qué se va Radix acá y se queda en el panel del corpus:** en la Task 4 hay que leer y escribir a mano el `scrollTop` del contenedor que scrollea. En Radix el que scrollea no es el componente que uno escribe, es un `Viewport` interno al que este `ui/scroll-area.tsx` no expone ningún ref — habría que modificar el componente de shadcn para agregarle un `viewportRef`. Un `div` con `overflow-y-auto` da un ref directo, respeta el *scroll anchoring* nativo del navegador y se explica en una línea. El costo es que la barra de scroll del centro se ve como la del sistema y la del panel del corpus se ve estilizada. Para el chat, vale la pena.

- [ ] **Step 3: Verificar que el centro todavía NO scrollea (sí, todavía está roto)**

```bash
npm run dev:client
```
Mandar 4 o 5 preguntas hasta llenar la pantalla. Esperado en este punto: la conversación se corta abajo y **no hay barra de scroll en ningún lado** — los mensajes viejos quedan inaccesibles. Es correcto: la caja ya está limitada (por eso no scrollea la página) pero todavía nadie dijo quién scrollea adentro. Lo arregla el Step 1 de la Task 3.

Lo que **sí** hay que confirmar acá: **los sidebars ya no se mueven** y el header tampoco.

- [ ] **Step 4: Verificar el type-check**

```bash
npm run build:client
```
Esperado: OK. Si aparece "ScrollArea is declared but never used" en `message-list.tsx`, quedó un import viejo: borrarlo.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(frontend): que la pantalla no scrollee entera y los paneles queden fijos

min-h-0 en la cadena de flex y overflow-hidden en la raiz: un hijo de flex
tiene min-height auto y se niega a medir menos que su contenido, asi que
flex-1 solo nunca creaba la caja de scroll.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: La columna del medio scrollea, y el composer flota arriba con fade

**Qué se construye:** un componente nuevo, `ChatPanel`, que es dueño de la columna central: la caja que scrollea, el composer flotando encima y el degradado entre los dos.

**Por qué hace falta:** el composer, hoy, es un hermano de la lista en un flex column. Eso lo deja fijo abajo, sí, pero con una raya dura arriba: el texto se **corta** contra el borde. En Claude el texto pasa *por debajo* de la barra y se desvanece. Para que algo pase por debajo de otra cosa, ese algo tiene que estar **fuera del flujo** (`absolute`), y entonces aparece un problema nuevo: el último mensaje quedaría tapado para siempre. La solución es un **espaciador invisible** al final de la lista, que mide exactamente lo mismo que el composer.

**Decisiones de este bloque:**
1. **El composer se mide, no se adivina.** El textarea crece hasta 5 renglones (`max-h-40`). Un `pb-28` fijo funciona con un renglón y tapa el último mensaje con cinco. Un `ResizeObserver` —el observador del navegador que avisa cuando un elemento cambia de tamaño— mantiene el espaciador siempre igual al composer.
2. **El espaciador mide el degradado + la barra**, no solo la barra. Así, cuando estás abajo del todo, el último mensaje queda **entero y nítido** por encima del degradado. El fade solo actúa sobre el texto que está pasando de largo.
3. **`ChatPanel` es un componente nuevo y no código dentro de `App.tsx`.** Ver "Estructura de archivos".

⚖️ **La decisión de este lab — ¿cómo se hace el "fading"?**

| Opción | Cómo se hace | Conviene cuando | No conviene cuando |
|---|---|---|---|
| **Degradado del color de fondo** ← elegida | Un `div` con `bg-linear-to-t from-background to-background/0` encima del texto | El fondo es un color plano, como acá. Es una línea de CSS y funciona en todos lados. | El fondo es una foto o un degradado: el truco se nota, porque el falso fondo no coincide. |
| `mask-image` sobre la caja que scrollea | `mask-image: linear-gradient(...)` recorta la opacidad del contenido | Hace falta que el fade funcione sobre **cualquier** fondo, o fade arriba y abajo a la vez. | Desvanece también la barra de scroll y, en algunos navegadores, obliga a rasterizar el texto (se ve apenas más borroso). |
| Nada: barra sólida con `border-t` (lo de hoy) | — | Una app densa tipo panel de control, donde el corte duro comunica "acá termina el área de contenido". | Se pidió explícitamente lo otro. |

**Nota sobre el nombre de la clase:** en Tailwind v4 el degradado lineal se llama `bg-linear-to-t` (en v3 era `bg-gradient-to-t`, que todavía funciona como alias viejo). Se usa el nombre nuevo. Y el destino es `to-background/0` (el mismo color con opacidad 0) en vez de `to-transparent`, porque algunos navegadores interpolan `transparent` pasando por el negro y el degradado sale sucio.

**Diferencia con el proyecto real:** igual, pero el `ChatPanel` real va a recibir el historial por props o por contexto en vez de llamar a `useChat()` adentro, para poder montarlo en una pantalla de demo con datos fijos sin pegarle al motor.

**Files:**
- Create: `apps/frontend/src/hooks/use-element-height.ts`
- Create: `apps/frontend/src/components/chat-panel.tsx`
- Modify: `apps/frontend/src/components/composer.tsx:32-54`
- Modify: `apps/frontend/src/App.tsx` (completo)

**Interfaces:**
- Consumes: `useChat()` → `{ history, isStreaming, sendMessage, stop }`; `<MessageList history />`; `<Composer isStreaming onSend onStop />`; `<AppShell leftSidebar children rightSidebar />` (todos de la Task 1) y la cadena de alturas de la Task 2.
- Produces: `useElementHeight<T>() → [ref, height]` y `<ChatPanel />`. La Task 4 le agrega el hook de scroll a este mismo `ChatPanel`.

- [ ] **Step 1: Crear `hooks/use-element-height.ts`**

```ts
// Tells you how tall an element currently is, and keeps telling you when it
// changes. Used for the composer: it grows as you type, and the spacer at the
// end of the conversation has to grow with it.

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Returns a ref to attach to the element, and its height in pixels.
 *
 * ResizeObserver is the browser API that watches an element's size. It is the
 * honest way to do this: reading the height once on mount would go stale the
 * moment the textarea grows a line, and listening to window resize would miss
 * that case entirely, because the window did not resize — the element did.
 *
 * useLayoutEffect and not useEffect: this runs before the browser paints, so
 * the first measurement lands without a visible one-frame jump.
 */
export function useElementHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver(() => {
      setHeight(element.getBoundingClientRect().height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, height]
}
```

- [ ] **Step 2: Crear `components/chat-panel.tsx`**

```tsx
// The middle column: the scrolling conversation with the composer floating on
// top of it. This is the only component that knows the conversation scrolls —
// MessageList just draws bubbles and Composer just draws an input.

import { MessageList } from '@/components/message-list'
import { Composer } from '@/components/composer'
import { useChat } from '@/hooks/use-chat'
import { useElementHeight } from '@/hooks/use-element-height'

export function ChatPanel() {
  const { history, isStreaming, sendMessage, stop } = useChat()
  // The composer is out of the normal flow, so it takes up no room. The spacer
  // at the end of the list gives that room back, exactly as much as it needs.
  const [overlayRef, overlayHeight] = useElementHeight<HTMLDivElement>()

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList history={history} />
        <div aria-hidden style={{ height: overlayHeight }} />
      </div>

      {/* pointer-events-none on the wrapper, auto on the bar: the fade strip
          is see-through to the mouse, so text under it stays selectable. */}
      <div ref={overlayRef} className="pointer-events-none absolute inset-x-0 bottom-0">
        <div className="h-8 bg-linear-to-t from-background to-background/0" />
        <div className="pointer-events-auto bg-background px-3 pb-3">
          <Composer isStreaming={isStreaming} onSend={sendMessage} onStop={stop} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Sacarle a `composer.tsx` su envoltorio de barra**

Ya no le toca decidir dónde está parado: eso ahora es de `ChatPanel`. Reemplazar el `return` (líneas 32-54) para que el `div` externo desaparezca y el JSX arranque directo en la caja redondeada:

```tsx
  return (
    <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border bg-secondary/50 p-2 shadow-sm">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Pregunta lo que quieras"
        rows={1}
        className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      {isStreaming ? (
        <Button size="icon" variant="destructive" className="shrink-0 rounded-full" onClick={onStop}>
          <Square className="size-4" />
        </Button>
      ) : (
        <Button size="icon" className="shrink-0 rounded-full" disabled={!text.trim()} onClick={send}>
          <Send className="size-4" />
        </Button>
      )}
    </div>
  )
```

(Se fueron `border-t p-3` del contenedor viejo y se sumó `shadow-sm`, que es lo que despega visualmente la barra del texto que le pasa por debajo.)

- [ ] **Step 4: Simplificar `App.tsx`**

Queda como archivo de cableado puro: ya no conoce el hook del chat.

```tsx
import { AppShell } from '@/components/app-shell'
import { ChatPanel } from '@/components/chat-panel'
import { CorpusPanel } from '@/components/corpus-panel'
import { EnginePanel } from '@/components/engine-panel'
import { FAKE_CORPUS, FAKE_ENGINE_STATE } from '@/lib/fake-data'

export default function App() {
  return (
    <AppShell
      leftSidebar={<CorpusPanel documents={FAKE_CORPUS} />}
      rightSidebar={<EnginePanel state={FAKE_ENGINE_STATE} />}
    >
      <ChatPanel />
    </AppShell>
  )
}
```

- [ ] **Step 5: Verificar en el navegador**

```bash
npm run dev:client
```
Con la conversación más larga que la pantalla, confirmar las cinco cosas:
1. **Hay barra de scroll en el centro**, y solo en el centro. Los sidebars y el header siguen quietos.
2. Scrolleando, el texto **se desvanece** al pasar por detrás de la barra de mensajes. No hay corte duro.
3. Bajando hasta el fondo, el **último mensaje se lee entero y nítido**, sin quedar tapado.
4. Con Shift+Enter, cinco renglones en el input: el composer crece y el último mensaje **sigue** legible al llegar al fondo (el espaciador creció con él).
5. Se puede **seleccionar con el mouse** el texto que está detrás del degradado.

- [ ] **Step 6: Verificar type-check y lint**

```bash
npm run build:client && npm run lint --workspace=apps/frontend
```
Esperado: OK y 0 errores.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(frontend): composer flotante con fade y scroll propio de la conversacion

Nuevo ChatPanel: el composer sale del flujo y flota sobre la caja que
scrollea, con un degradado arriba. Un espaciador medido con ResizeObserver
le devuelve el lugar que ocupa, asi el ultimo mensaje nunca queda tapado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Que la conversación se siga sola (y se suelte si el usuario scrollea)

**Qué se construye:** el hook `useStickToBottom` y el botón flotante ↓.

**Por qué hace falta — y por qué no alcanza con "scrollear al fondo cuando llega texto":**

La regla ingenua sería "cada vez que llega un token, `scrollTop = scrollHeight`". Funciona… hasta que el usuario scrollea para arriba a releer algo mientras el modelo sigue escribiendo: cada token lo patea de vuelta abajo. Es de las cosas más molestas que puede hacer una UI.

Entonces el hook tiene que sostener **una sola idea**: *¿el usuario está mirando el final?*
- **Sí** → seguir el texto pegado al fondo.
- **No** → no tocarle el scroll, y ofrecerle el botón ↓ para volver.

"Está mirando el final" no es "está exactamente en el píxel del fondo": es "le falta menos de 64 px". Ese margen existe porque el usuario nunca queda en el fondo exacto (un trackpad se pasa por 3 px) y porque el texto sigue creciendo mientras se lee.

Y hay un detalle que no es obvio: **el contenido creciendo NO dispara un evento `scroll`.** El evento `scroll` avisa cuando cambia `scrollTop`; cuando llega un token, `scrollTop` no cambió — cambió `scrollHeight`, se movió el piso. Por eso hacen falta dos oyentes distintos:
1. `scroll` → responde *qué quiere el usuario*.
2. `ResizeObserver` → responde *cuándo creció el contenido*.

⚖️ **La decisión de este lab — ¿cómo se mantiene la vista pegada al fondo?**

| Opción | Cómo se hace | Conviene cuando | No conviene cuando |
|---|---|---|---|
| **`scroll` + `ResizeObserver`** ← elegida | ~35 líneas propias, cero dependencias | Hace falta la regla completa: seguir, soltar si el usuario sube, volver a enganchar. Es lo que hacen Claude y ChatGPT. | Un log que solo tira líneas y nadie relee: ahí es sobreingeniería. |
| `flex-direction: column-reverse` | El navegador ancla solo al "fondo" (que en realidad es el `top`) | Un feed puramente cronológico, sin encabezado, donde los mensajes llegan de a uno. Cero JS. | El orden del DOM queda invertido: el tabulador y los lectores de pantalla recorren la conversación al revés. Descalificante. |
| `endRef.current.scrollIntoView()` en un `<div>` centinela | Dos líneas | Un salto puntual: "llevame al mensaje nuevo" cuando se hace clic en una notificación. | Streaming: no hay forma limpia de preguntarle "¿el usuario está abajo?", y en modo `smooth` cada token pelea contra el anterior. |
| `IntersectionObserver` sobre un centinela al final | El navegador avisa si el final está a la vista | Además hay que saber cuándo cargar mensajes viejos al llegar arriba (scroll infinito). Se resuelven las dos cosas con la misma herramienta. | Para esto solo: es una API asincrónica y con `rootMargin` para calibrar, cuando la cuenta de la distancia al fondo es **una línea**. |

**Sobre `useMirrorRef`:** el `ResizeObserver` se registra una sola vez, al montar. Su función lee "¿estamos enganchados?" cada vez que se dispara — y si leyera la variable de estado, leería para siempre el valor que había en el render donde se creó (eso es un *stale closure*: una función que se quedó con una foto vieja de las variables). Por eso el "enganchado" vive en **dos** lugares: un `ref` (siempre al día, para que lo lean los oyentes) y un `useState` (para que React sepa cuándo dibujar o esconder el botón).

**Diferencia con el proyecto real:** existe `use-stick-to-bottom` en npm, que resuelve esto con animación por resortes y soporte de `ResizeObserver` anidado. En el proyecto real conviene evaluarla. Acá se escribe a mano porque son 35 líneas y porque entender *por qué* hacen falta dos oyentes vale más que la dependencia.

**Files:**
- Create: `apps/frontend/src/hooks/use-stick-to-bottom.ts`
- Create: `apps/frontend/src/hooks/use-mirror-ref.ts`
- Modify: `apps/frontend/src/hooks/use-chat.ts` (borrar `useMirrorRef` de adentro e importarlo)
- Modify: `apps/frontend/src/components/chat-panel.tsx`

**Interfaces:**
- Consumes: `<ChatPanel />` y `useElementHeight` de la Task 3; `useChat()` de la Task 1.
- Produces: `useStickToBottom<S, C>() → { scrollRef, contentRef, isPinned, scrollToBottom }` y `useMirrorRef<T>(value) → RefObject<T>`.

- [ ] **Step 1: Extraer `hooks/use-mirror-ref.ts`**

Sale tal cual de `use-chat.ts` (donde se llamaba `useEspejo`, traducido en la Task 1). Ahora lo usan dos hooks, así que se muda a su propio archivo:

```ts
import { useEffect, useRef, type RefObject } from 'react'

/**
 * A ref that always holds the latest value.
 *
 * Why it exists: a listener registered once on mount keeps the variables from
 * the render that created it — a stale closure. Reading through a ref sidesteps
 * that: the ref object never changes, only what is inside it.
 */
export function useMirrorRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
```

Después, en `use-chat.ts`: borrar la función local y agregar `import { useMirrorRef } from '@/hooks/use-mirror-ref'`. El resto del hook no se toca.

- [ ] **Step 2: Crear `hooks/use-stick-to-bottom.ts`**

```ts
// Keeps the view glued to the bottom of a scrolling box while new content
// arrives — unless the user scrolled up, in which case it gets out of the way.

import { useCallback, useEffect, useRef, useState } from 'react'

/** How far from the bottom still counts as "the user is at the bottom". */
const PIN_THRESHOLD_PX = 64

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight
}

export function useStickToBottom<S extends HTMLElement, C extends HTMLElement>() {
  const scrollRef = useRef<S>(null)
  const contentRef = useRef<C>(null)
  // Two copies of the same truth, on purpose: the ref is what the listeners
  // read (always current, never triggers a render), the state is what React
  // reads to show or hide the button.
  const isPinnedRef = useRef(true)
  const [isPinned, setIsPinned] = useState(true)

  const setPinned = useCallback((value: boolean) => {
    isPinnedRef.current = value
    setIsPinned(value)
  }, [])

  // 1. What the user wants. Every scroll — wheel, trackpad, keyboard, and our
  //    own programmatic one — ends up here asking the same question.
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handleScroll = () => setPinned(distanceFromBottom(element) <= PIN_THRESHOLD_PX)
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [setPinned])

  // 2. When the content grew. A new token does NOT fire a scroll event:
  //    scrollTop did not move, the floor did. Only a ResizeObserver sees it.
  useEffect(() => {
    const element = scrollRef.current
    const content = contentRef.current
    if (!element || !content) return

    const observer = new ResizeObserver(() => {
      // Instant, not smooth: a smooth scroll per token would fight the next one.
      if (isPinnedRef.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    // Pin first: if the content is still growing, the observer takes over from
    // here and keeps following, instead of landing short.
    setPinned(true)
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [setPinned])

  return { scrollRef, contentRef, isPinned, scrollToBottom }
}
```

- [ ] **Step 3: Enganchar el hook y el botón en `chat-panel.tsx`**

El archivo queda así (los cambios respecto de la Task 3: los dos refs, `handleSend` y el bloque del botón):

```tsx
import { ArrowDown } from 'lucide-react'
import { MessageList } from '@/components/message-list'
import { Composer } from '@/components/composer'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { useElementHeight } from '@/hooks/use-element-height'
import { useStickToBottom } from '@/hooks/use-stick-to-bottom'

export function ChatPanel() {
  const { history, isStreaming, sendMessage, stop } = useChat()
  const [overlayRef, overlayHeight] = useElementHeight<HTMLDivElement>()
  const { scrollRef, contentRef, isPinned, scrollToBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  // Sending always takes you back down: you just wrote it, you want to see it.
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
          <Composer isStreaming={isStreaming} onSend={handleSend} onStop={stop} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verificar el comportamiento normal (seguir el texto)**

```bash
npm run dev:client
```
Pedir una respuesta larga a propósito: *"escribime 40 renglones sobre la historia del café"*.
Esperado: la vista **baja sola** a medida que el modelo escribe, sin saltos ni temblor, y el último renglón siempre queda visible arriba del composer.

- [ ] **Step 5: Verificar el caso borde del pedido (el usuario toma el control)**

Con el modelo todavía escribiendo, scrollear para arriba con la rueda.
Esperado, las cuatro:
1. La vista **se queda donde el usuario la dejó**. El texto que sigue llegando ya no la arrastra.
2. Aparece el **botón ↓**, centrado, justo arriba del composer.
3. Al hacer clic, vuelve al fondo con animación suave, el botón desaparece y **se reengancha**: sigue bajando sola con lo que falta.
4. Bajando a mano hasta el fondo (sin el botón), también se reengancha.

- [ ] **Step 6: Verificar mandar un mensaje estando arriba**

Scrollear al principio de la conversación y mandar una pregunta nueva.
Esperado: baja al fondo y engancha con la respuesta nueva.

- [ ] **Step 7: Verificar type-check y lint**

```bash
npm run build:client && npm run lint --workspace=apps/frontend
```
Esperado: OK y 0 errores.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(frontend): autoscroll pegado al fondo con boton para volver

useStickToBottom: un listener de scroll decide si el usuario esta mirando
el final y un ResizeObserver detecta que crecio el contenido (un token no
dispara evento scroll). Si el usuario sube, se suelta y aparece el boton.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Repaso final y estado del proyecto

**Qué se hace:** una pasada completa sobre las cuatro cosas pedidas, en conjunto, y dejar anotado dónde quedó todo para la sesión que viene.

**Files:**
- Modify: `qvac-context/05-estado-y-progreso.md` (⚠️ está **fuera** de este repo, en `Hackathon/`)

- [ ] **Step 1: Repaso de los cuatro requisitos, en una sola corrida**

```bash
npm run dev:client
```
Con la conversación larga y la ventana en tamaño normal:
1. ☑ Los sidebars y el header no se mueven al scrollear.
2. ☑ La conversación baja sola mientras llega la respuesta; si el usuario sube, lo deja leer.
3. ☑ El composer está fijo abajo y el texto se desvanece al pasarle por detrás.
4. ☑ `grep` no encuentra identificadores en español (ver Task 1, Step 10).

- [ ] **Step 2: Repaso con la ventana angosta**

Achicar la ventana hasta ~700 px de ancho y confirmar: los paneles se pueden cerrar con los botones del header, el botón ↓ sigue centrado sobre el composer, y el degradado sigue tapando el ancho completo del centro.

- [ ] **Step 3: Repaso en modo oscuro**

La captura de referencia es en oscuro y **el degradado es el punto frágil**: `from-background` toma el color del tema, así que tiene que verse igual de invisible en los dos. Si el proyecto no tiene todavía un switch de tema, alcanza con agregar a mano la clase `dark` al `<html>` desde el inspector del navegador.

- [ ] **Step 4: Actualizar el estado del proyecto**

En `Hackathon/qvac-context/05-estado-y-progreso.md`, anotar bajo el cambio de foco del 21/09: front con layout de tres columnas terminado (scroll, autoscroll y composer flotante), código en inglés, y cuál es el bloque siguiente de `08-plan-front.md`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: repaso final del front y estado del proyecto

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Pregunta abierta (no bloquea el plan)

**El texto que ve el usuario sigue en español** ("Corpus", "Este equipo", "Pregunta lo que quieras", los aria-labels). El pedido era sobre el código, y la copy no es código. Pero si la demo del challenge se presenta en inglés, conviene decidirlo antes de que haya más pantallas: hoy son ~15 strings en 4 archivos, con `next-intl` o sin nada. Es una tarea de 20 minutos ahora y de varias horas más adelante.
