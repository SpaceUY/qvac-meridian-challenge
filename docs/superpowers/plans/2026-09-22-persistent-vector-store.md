# Persistent Local Vector Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Para esta sesión en particular:** el `CLAUDE.md` del proyecto manda por encima de esto. Cada tarea trae sus **bloques de ~50 líneas** con nombre. Se escribe un bloque, se frena, se explica línea por línea, y recién ahí el siguiente. Lucas lee, pregunta y rompe.

**Goal:** Reemplazar el vector store en memoria por LanceDB en disco, poblado con embeddings reales de QVAC, con un ingest incremental que no vuelva a embeber documentos que no cambiaron.

**Architecture:** El backend ya tiene el esqueleto de RAG en `apps/backend/src/rag/` con dos puertos (`EmbeddingPort`, `VectorStorePort`) y dos adaptadores de mentira (`FakeEmbeddingPort`, `InMemoryVectorStore`). Este plan escribe los adaptadores reales detrás de esos mismos puertos — `RagRetrievalService`, `contextBuilder`, `graph.ts` y `AgentService` **no se tocan** — y agrega un módulo de ingesta (`rag/ingest/`) con su propio CLI. La ingesta es un proceso aparte del servidor: escribe la tabla; el servidor solo la abre y busca.

**Tech Stack:** TypeScript (NodeNext, strict), Node 24+, Express 5, vitest 5, `@qvac/sdk@0.18.2` (`ragChunk`, `embed`, `loadModel`), `@lancedb/lancedb@0.39.0`, LangGraph.

**Spec:** ClickUp `86bc1hmcc` — https://app.clickup.com/t/3117051/86bc1hmcc · requisito `[2.3]` del challenge (y habilita `[2.2]`). Texto íntegro del ticket y el diseño previo: `Hackathon/qvac-context/06-tickets-proyecto-real.md` § "TICKET 1". El alcance ajustado después del merge del PR #17 está en la sección siguiente — **leerla primero**.

---

## ⚠️ Revisión del 23/09/2026 contra `main` después del PR #17 (`28d5335`) — leer primero

El PR #17 (*"Wire the chat UI to the real backend chat API"*) se mergeó después de escribir este plan. Se volvió a leer `main` entero y se corrieron sus tests. Esto es lo que cambió y cómo se adaptó el plan.

**Regla de alcance, acordada con Lucas:** ser fiel al ticket. Entra **solo** lo que el ticket pide o lo que hace falta para cumplirlo; todo lo demás va a "Límites conocidos" (Tarea 9, README), no al código.

### Qué encontramos en `main`

| # | Hallazgo | Efecto en el plan |
|---|---|---|
| 1 | **`main` no está en verde.** 3 archivos de test fallan (`fullCorpusContext.test.ts` y `corpusContext.test.ts` importan módulos que no existen; `agentService.test.ts` espera texto de garantía que el RAG falso no recupera) y `tsc` marca 5 errores (imports sin usar + esos módulos). Ninguno es de este ticket. | Todo "Expected: PASS, todo" / "sin errores" pasa a ser **"sin fallas nuevas respecto de la línea de base"**. La línea de base se toma en la Tarea 0. |
| 2 | **`server.ts` ya usa el RAG**, con el store falso (`FakeEmbeddingPort` + 6 fixtures + `RAG_CONFIG` con `minScore: 0.3`). El comentario del placeholder dice que reemplazarlo es *"Lucas's next ticket"*. | El ticket pide *"Integrate LanceDB as the vector store"* y *"Embeddings survive application restart"*: la aplicación es el servidor. **La Tarea 9 ahora incluye `server.ts`** (cambio mínimo: ~4 líneas). |
| 3 | `ChatQVAC.ensureModel()` olvida la promesa si la carga falla, para poder reintentar. El `QvacEmbeddingAdapter` de este plan no lo hacía: una descarga interrumpida lo dejaba roto hasta reiniciar. | Corregido en la Tarea 2, con un test nuevo. |
| 4 | Hay un **segundo** `FakeModelRuntime implements ModelRuntimePort` en `ai/orchestrator/agentService.test.ts`. | Nombrado explícitamente en la Tarea 1 (sin él, `tsc` suma un error nuevo). |
| 5 | Los `source` de los fixtures no son relativos al corpus (`'support-sla-faq.html'`, sin carpeta). | Sirve de "antes" medible: hoy el sistema **no puede** citar bien. |
| 6 | El SDK busca `qvac.config.*` subiendo desde el directorio actual hasta el primer `package.json` (`client/config-loader/resolve-config.node.js`). | Constraint nuevo: todo comando que cargue un modelo corre **desde `apps/backend`**, o el modelo se baja a otro cache. |
| 7 | LanceDB 0.39 tiene `table.vectorSearch()` (devuelve `VectorQuery` directo) y `mergeInsert(...).whenNotMatchedBySourceDelete({ where })`. | Tarea 3 usa `vectorSearch()` (sin cast). Tarea 4: se simplifica `replaceDocumentChunks` y se corrige la tabla de trade-offs. |

### Qué NO se hace (fuera del ticket, anotado como límite conocido)

- **Huella de configuración en el estado.** Si cambia `CHUNK_OPTIONS` o el modelo de embeddings, el ingest no se entera: hay que `rm -rf .lancedb`. Se documenta en el README (Tarea 9).
- **Precargar el modelo de embeddings en `AgentService.preload()`.** Se carga con la primera pregunta: esa respuesta tarda unos segundos más, y `/api/chat/status` dice `ready` cuando solo el de chat está cargado.
- **Script `corpus:ingest` en la raíz** para `qvac-eval.json` — es del Ticket 9.
- **Limpiar HTML** de `support-sla-faq.html` antes de chunkear.
- **`ai/demo.ts` y `speech/demo.ts`** siguen con el store falso.
- **Los 3 tests rotos de `main`**: no son de este ticket. Se avisan al equipo, no se arreglan acá.

### Cómo se demuestra que la solución es la correcta — antes y después

| Qué | Antes (Tarea 0) | Después |
|---|---|---|
| Tests + tipos | Se guarda la foto de fallas actuales | Cada tarea: `diff` contra la foto → **cero líneas nuevas** |
| Recuperación: 10 preguntas de `qvac-lab/preguntas-eval.json`, en inglés, ¿aparece el archivo correcto en el top 4? | Store falso → **≤ 5/10** (5 preguntas imposibles: su archivo no está en los fixtures) | LanceDB + EmbeddingGemma → esperado **≥ 7/10** (Tarea 9) |
| La app real: pregunta cuya respuesta **no** está en los fixtures (autoridad de descuento de un AE = 10%, `emails/014-discount-authority.md`) | El servidor no puede contestarla con el corpus | La contesta; y **después de reiniciar el servidor** la sigue contestando sin correr el ingest (Tarea 9) |
| Criterios del ticket | — | Los 6 checks de la Tarea 8 |

El script de evaluación de recuperación **no es código del producto**: vive en `Hackathon/qvac-lab/verificacion/`, fuera del repo, y no se commitea.

---

## El ticket, verbatim

> **Description:** Integrate LanceDB as the file-backed local vector store. Store embeddings, chunk text, source file paths, chunk identifiers, and retrieval metadata required to produce citations. Add persistence and basic ingestion state tracking so the full corpus does not need to be re-embedded every time the application restarts. Support safe re-ingestion when source content changes.
>
> **Acceptance criteria:** Embeddings survive application restart; vector search works locally; already-ingested unchanged documents are not unnecessarily re-embedded.

Y el requisito del challenge que lo origina:

> **[2.3]** Persist the embeddings to a local, file-backed vector store (SQLite-Vector, LanceDB, ChromaDB or similar) that you populate through the `ragChunk()` and `embed()` primitives, **with the store's vector dimension matched to your embedding model**. QVAC's built-in RAG workspace (`ragIngest()` + `ragSearch()`) does not satisfy this requirement.

---

## Global Constraints

Valen para **todas** las tareas. Los requisitos de cada tarea las incluyen implícitamente.

- **`@qvac/sdk` pinneado a `0.18.2` exacto.** Sin `^`, sin `~`. Ya está así en `apps/backend/package.json`; no tocarlo.
- **`@lancedb/lancedb` se instala en `0.39.0`** — la versión verificada y corrida en el Lab 4 sobre macOS arm64. Se instala con `--save-exact`.
- **Cero APIs de IA en la nube.** Todo local. El único tráfico de red permitido es la descarga inicial de los pesos del modelo al cache de QVAC.
- **`ragIngest()` y `ragSearch()` del SDK están prohibidos** para esta parte — el challenge lo dice explícitamente. Se usan **solo** `ragChunk()` y `embed()`.
- **La ruta guardada en cada fila es relativa a la raíz del corpus.** `reports/q1-2026-sales-summary.md`, nunca `corpus/reports/...` ni una ruta absoluta. El challenge: *"File paths are relative to the corpus root as provided in corpus.zip"*. Si esto sale mal, las citas del Ticket 2 salen mal y el evaluador automático de Tether baja la nota aunque la respuesta sea correcta.
- **La dimensión del vector es 768** — medida en el Lab 3 contra `EMBEDDINGGEMMA_300M_Q4_0`. Es la dimensión de la tabla. No se hardcodea en dos lugares: vive en `config/rag.config.ts` y se **verifica** contra el modelo en el ingest.
- **El motor del modelo de embeddings es `llamacpp-embedding`**, no `llamacpp-completion`. `QvacRuntimeAdapter.load()` usa `DEFAULT_MODEL_TYPE = 'llamacpp-completion'` cuando el `ModelSource` no trae `modelType` — el source de embeddings **tiene que** traerlo explícito o el load falla.
- **`close()` del SDK lo sigue llamando solo `ModelManagementService`.** Ningún adaptador nuevo llama `close()` por su cuenta: el worker de QVAC es uno solo para todo el proceso y cerrarlo desde dos lados rompe al otro.
- **Nunca inventar una firma de API ni una versión de paquete.** Si no está verificada, se lee el `.d.ts` del paquete instalado antes de escribirla.
- **`npm run ingest` corre en la fase `setup` de la evaluación de Tether, nunca en `start`.** El challenge (`qvac-context/01-challenge-texto-completo.md`, "How we will run your submission") exige un `qvac-eval.json` con `setup` (red permitida, "may take as long as it needs") separado de `start` ("must not require network access" — corren la fase de preguntas con la red bloqueada). El ingest, que puede descargar 277 MB la primera vez, tiene que quedar del lado de `setup`. Esto ya está resuelto por el diseño (CLI aparte, Tarea 8) — se deja anotado acá porque es la evidencia externa de por qué esa separación no es un capricho de arquitectura.
- **`git` :** rama nueva desde `origin/main` (Tarea 0). Commits frecuentes, uno por tarea como mínimo. Conventional commits (`feat:`, `test:`, `chore:`).
- **"Pasa" significa "sin fallas nuevas respecto de la línea de base".** `main` ya trae 3 archivos de test rotos y 5 errores de `tsc` que no son de este ticket. Cada vez que el plan dice "correr la suite" o "typecheck", se corre el comando de comparación de la Tarea 0 (Step 2) y el `diff` tiene que salir **vacío**. Arreglar esas fallas preexistentes está fuera de alcance.
- **Todo comando que cargue un modelo de QVAC corre desde `apps/backend`** (o vía `npm run ... --workspace=apps/backend`, que hace lo mismo). El SDK busca su config subiendo desde el directorio actual hasta el primer `package.json`: desde `apps/backend` encuentra `qvac.config.mjs` (cache en `<repo>/.qvac-cache`); desde la raíz del repo encuentra `qvac.config.json`, que no fija cache, y el modelo se bajaría a otro lado.
- **Archivos de verificación fuera del repo:** `VERIF=/Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-lab/verificacion`. Ahí viven la línea de base y el script de evaluación de recuperación. Nunca se commitean.

---

## Hallazgos de los labs que cambian o confirman este plan

Revisión del 23/09/2026 contra `qvac-lab/notas/*.md` y el challenge completo. Tres hallazgos con efecto real sobre este plan (uno confirma una decisión con evidencia dura, dos corrigen algo que el plan tenía mal o incompleto):

**1. CONFIRMA — el protocolo de evaluación de Tether valida la separación ingest/servidor.** El challenge (`qvac-context/01-challenge-texto-completo.md`, sección "How we will run your submission") exige un `qvac-eval.json` en la raíz del repo con dos fases separadas: `setup` ("may download models and ingest the corpus, and **may take as long as it needs**") y `start` ("**must not require network access**: we run the question phase with outbound network blocked"). Esto no es una preferencia de diseño nuestra — **es la forma en que Tether corre la evaluación**. Confirma, con evidencia externa y no solo con nuestro propio razonamiento, la decisión ya tomada de que `npm run ingest` sea un comando aparte del arranque del servidor: el ingest (que descarga el modelo de embeddings la primera vez) vive en `setup`; el servidor, en `start`, arranca **sin red**. Anotado como constraint explícito en Global Constraints, más abajo. La Tarea 9 conecta el store al servidor. Como `npm run ingest` carga el modelo de embeddings, cuando corre en `setup` también lo deja descargado en `.qvac-cache`, y el servidor lo encuentra ahí en `start`, sin red.

**2. CORRIGE — un número del lab que sería un error copiar.** `notas/lab-05-respuesta-con-cita.md` calibró `UMBRAL_DISTANCIA = 1.1` con datos reales, y `notas/lab-04-chunking-y-lancedb.md` mide distancias de `0.77`/`0.95`/`0.97` comparando `chunkSize`. **Ninguno de los dos labs llama `.distanceType('cosine')`** (verificado leyendo `04-chunking-y-lancedb.mjs` y `05-respuesta-con-cita.mjs`: es `tabla.search(vector).limit(n).toArray()`, sin más) — corren con el default de LanceDB, que es **L2**, no coseno. Nuestro `LanceDbVectorStore` (Tarea 3) sí fija `distanceType('cosine')`, a propósito, por las razones ya explicadas en esa tarea. Son dos escalas distintas: **ningún número de los labs es transferible a `DEFAULT_RAG_CONFIG.minScore`**. La Tarea 9 ya prescribe medir de nuevo contra nuestro propio código — este hallazgo es la razón explícita de por qué esa remedición es obligatoria y no un paso de más.

**3. CORRIGE un comentario del plan — `chunkSize: 600` sí está justificado, mejor de lo que decía.** El comentario original de `CHUNK_OPTIONS` en la Tarea 2 decía *"Not tuned against a retrieval metric"*. Es incompleto: `lab-04-chunking-y-lancedb.md` documenta una comparación real de 150 vs. 600 vs. 2000 contra el corpus real, y **600 no ganó por mejor score** (150 daba mejor distancia) — ganó porque sus 3 resultados top venían de 3 archivos distintos en vez de fragmentar el mismo documento. Es una justificación cualitativa real, no una medida de `recall@k` sobre las 10 preguntas. Corregido el comentario en la Tarea 2 para reflejar esto con precisión — ni de más ni de menos.

Dos hallazgos adicionales, **sin acción sobre este plan**, documentados como límite conocido:

- `lab-04...md`: los `.csv`/`.json` del corpus se pasan a `ragChunk()` como texto crudo — "simplificación válida para el lab, no para el proyecto real". Nuestro `corpusReader` (Tarea 5) hereda exactamente esa simplificación. Se agrega como límite conocido explícito en la Tarea 9 (Tether pide documentar los trade-offs, no ocultarlos).
- `lab-03-embeddings.md`: sugiere que una búsqueda híbrida (embeddings + palabras clave) suele superar a embeddings puros. Fuera de alcance de este ticket — se anota como mejora futura, no como pendiente de esta tarea.
- `lab-06-tool-calling.md` (no afecta este ticket): el modelo de 1B no dispara tool calls de forma confiable — es un hallazgo real pero de otro ticket (tool calling), lo menciono solo porque es la clase de cosa que si en algún momento cambiamos de modelo de chat, hay que re-verificar contra el ticket 3, no contra este.

---

## Spike corrido el 23/09/2026 — los 4 supuestos de LanceDB, probados con procesos reales

Antes de escribir las Tareas 3/4, se corrió un spike descartable (3 scripts en `qvac-lab/_spike-lancedb/`, borrados al terminar) que prueba los cuatro supuestos de los que cuelga todo este plan — **como tres invocaciones de `node` separadas**, no tres funciones en el mismo proceso, para que "el proceso reinicia y encuentra los datos" sea un hecho probado y no una suposición sobre cómo se comporta LanceDB entre procesos.

| # | Supuesto | Resultado |
|---|---|---|
| 1 | `distanceType('cosine')` con 768 dims rankea como se predice a mano | ✅ query `[1,0]` (embebido en 768 dims) dio exactamente `1.0000 / 0.7071 / 0.0000` contra vectores `[2,0] / [1,1] / [0,5]` |
| 2 | `delete` por `source` + `add` deja las demás filas intactas | ✅ el re-ingest de `reports/a.md` (2 filas → 1) no tocó ninguna fila de `emails/b.md` |
| 3 | La tabla sobrevive a un reinicio de proceso | ✅ el Proceso 3 (un `node` nuevo, sin memoria de los dos anteriores) leyó el estado exacto que dejó el Proceso 2 |
| 4 | El esquema se infiere bien con la forma real de fila (`ChunkRow`, 8 campos) | ✅ `FixedSizeList[768]<Float32>` para `vector`, sin errores |

Los 5 asserts automáticos del Proceso 3 pasaron con exit code 0. **Los 4 supuestos del plan quedan confirmados con evidencia, no con lectura de documentación.**

**Un hallazgo extra, no buscado:** `table.delete(predicate)` devuelve `{ numDeletedRows, version }` — no solo `void` como asumía el tipo `Promise<DeleteResult>` sin mirar el contenido. Es información gratis para loguear en el CLI de ingesta (Tarea 8): *"reports/a.md: 2 chunks viejos borrados, 1 nuevo escrito"* es más útil que solo el conteo final de filas. Se agrega como mejora menor en la Tarea 4.

**Cruce contra el challenge (`QVAC Challenge v3.pdf`):** el ejemplo de `citations` que exige la sección "How we will run your submission" es `{ "file": "...", "score": 0.83 }` — un número que se lee como "más alto es mejor" (0.83 sobre un máximo implícito de 1). Nuestra convención (`score = 1 - distancia`, con coseno) devuelve exactamente esa forma — `1.0000` para un match perfecto — sin ninguna conversión adicional en la capa de citas. Si hubiéramos usado la distancia cruda de LanceDB (como hacían los labs, sin `distanceType('cosine')`), el `score` de la cita habría sido "más bajo es mejor" y sin techo fijo — technically válido según el schema (`score` es opcional), pero conceptualmente al revés de lo que sugiere el ejemplo del PDF. Esto no cambia ninguna tarea del plan — ya estaba bien — pero es la confirmación de que la Tarea 3 tomó la decisión correcta también de cara al Ticket 2 (citas), no solo por prolijidad interna.

---

## Estado de partida (verificado el 23/09/2026 contra `origin/main` = `28d5335`, después del PR #17)

Lo que **ya existe** y no se toca:

| Archivo | Qué hace |
|---|---|
| `rag/domain/ports.ts` | `EmbeddingPort`, `VectorStorePort` |
| `rag/domain/types.ts` | `RetrievedChunk`, `RagRetrievalConfig`, `RagRetrievalResult` |
| `rag/service/rag.service.ts` | `RagRetrievalService`: embed → search → dedupe → cap |
| `rag/service/contextBuilder.ts` | Formatea los chunks recuperados para el prompt |
| `ai/orchestrator/graph.ts` | El grafo vivo del chat: `START → rag → llm → (toolNode) → END`. **No** corta en `hasEvidence`: siempre llama al LLM, con el contexto que haya |
| `ai/orchestrator/agentService.ts` | Recibe un `RagRetrievalService` por constructor; `preload()` carga **solo** el modelo de chat |
| `chat/chat.router.ts` | `GET /api/chat/status`, `POST /api/chat/preload`, `POST /v1/chat/completions` (SSE). Todavía no manda `result.chunks` — eso es el Ticket 2 |
| `models/` | `ModelManagementService` + `QvacRuntimeAdapter` (load/infer/chat/unload/close) |
| `corpus/` | 30 archivos de texto + 2 imágenes, commiteados en la raíz del repo |

Lo que **ya existe** y este plan **sí** toca, por el PR #17:

| Archivo | Hoy | Después de este plan |
|---|---|---|
| `server.ts` (líneas 30–45) | `FakeEmbeddingPort` + `buildFixtureVectorStore` + `RAG_CONFIG` local (`minScore: 0.3`) | `QvacEmbeddingAdapter` + `LanceDbVectorStore` + `DEFAULT_RAG_CONFIG` medido (Tarea 9) |

Lo que sigue usando el store falso **a propósito** (fuera de alcance): `ai/demo.ts`, `speech/demo.ts`, `ai/orchestrator/agentService.test.ts`.

Lo que se **reemplaza o queda obsoleto**:

| Archivo | Destino |
|---|---|
| `rag/infra/fakeEmbedding.adapter.ts` | Sigue existiendo (sirve para tests sin modelo), pero deja de ser el adaptador de producción |
| `rag/infra/inMemoryVectorStore.ts` | Idem: queda como doble de test, ya no es el store real |
| `rag/infra/fixtures/corpus-chunks.fixture.ts` | Queda solo para tests; deja de ser la fuente de datos del demo |

### Superficie de conflicto con el resto del equipo

Verificado con `git grep` sobre `origin/main`. De los archivos que este plan **modifica**, solo dos tienen actividad reciente de otra gente:

| Archivo | Quién lo tocó | Riesgo |
|---|---|---|
| `config/models.config.ts` | PR #15 (lo creó) y PR #16 (TTS, +20 líneas) | **Bajo pero real.** Es el archivo caliente del repo: cada feature nuevo agrega su sección. Nuestro cambio son ~12 líneas en la sección "Embeddings models", que hoy nadie más toca. Rebasear seguido. |
| `apps/backend/README.md` | PR #16 le agregó 45 líneas | **Bajo.** Secciones distintas. |
| `models/domain/ports.ts`, `models/service/models.service.ts`, `models/infra/qvacRuntimeAdapter.ts` | PR #15 | **Bajo.** Nuestro diff es aditivo (un método en cada uno). |
| Todo `apps/backend/src/rag/**` | nadie desde que se creó | **Cero.** |

`feat/chat-api-integration` ya está mergeada (PR #17). De las ramas que siguen abiertas, la única que toca lo mismo que este plan es **`feat/openapi-chat-endpoint-frontend-integration`** (Ernius): cambia `server.ts` y agrega una constante en `rag/service/rag.service.const.ts`. Esa rama **ya tiene conflictos con `main`** por su cuenta (duplica el endpoint `/v1/chat` que trajo el #17). Si se mergea antes que este plan, releer `server.ts` antes de la Tarea 9.

---

## File Structure

### Se crean

```
apps/backend/src/config/
  rag.config.ts                       # rutas, nombre de tabla, opciones de chunking, dimensión

apps/backend/src/rag/infra/
  qvacEmbedding.adapter.ts            # EmbeddingPort real, vía ModelManagementService
  qvacEmbedding.adapter.test.ts
  qvacChunker.adapter.ts              # ChunkerPort real, vía ragChunk() del SDK
  lanceDbVectorStore.ts               # VectorStorePort + VectorStoreWriterPort sobre LanceDB
  lanceDbVectorStore.test.ts

apps/backend/src/rag/ingest/
  corpusReader.ts                     # listar recursivo + leer + hashear + ruta relativa
  corpusReader.test.ts
  corpusIngest.service.ts             # el diff: qué embeber, qué saltear, qué borrar
  corpusIngest.service.test.ts
  ingest.cli.ts                       # el entrypoint de `npm run ingest`
```

### Se modifican

```
apps/backend/package.json                        # dep @lancedb/lancedb + script "ingest"
apps/backend/src/models/domain/ports.ts          # + embed() en ModelRuntimePort
apps/backend/src/models/infra/qvacRuntimeAdapter.ts  # + embed() contra el SDK
apps/backend/src/models/service/models.service.ts    # + embed() con assertLoaded
apps/backend/src/models/service/models.service.test.ts # el fake implementa embed()
apps/backend/src/ai/orchestrator/agentService.test.ts  # su FakeModelRuntime implementa embed()
apps/backend/src/config/models.config.ts         # EMBEDDING_MODEL_SOURCE real
apps/backend/src/server.ts                       # store falso -> LanceDB + embeddings reales
apps/backend/src/rag/service/rag.service.const.ts # minScore medido
apps/backend/README.md                           # ingest + límites conocidos
apps/backend/src/rag/domain/ports.ts             # + embedBatch(), + ChunkerPort, + VectorStoreWriterPort
apps/backend/src/rag/domain/types.ts             # + ChunkRecord
apps/backend/src/rag/infra/fakeEmbedding.adapter.ts  # + embedBatch()
apps/backend/src/ai/ragDemo.ts                   # usa LanceDB + embeddings reales
.gitignore                                       # ignora .lancedb/
```

### ⚖️ La decisión de estructura: ¿dónde vive el `embed()` del SDK?

`models/` tiene una regla escrita: *"Only `infra/qvacRuntimeAdapter.ts` imports `@qvac/sdk`"*. Cargar y usar un modelo de embeddings **es** una operación de modelo, así que va ahí.

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **`embed()` en `ModelRuntimePort` + `QvacRuntimeAdapter`** (elegida) | Cuando la operación es del ciclo de vida de un modelo. Reusa `assertLoaded`, `unloadAll`, `close`, el mapeo de errores, y evita que dos módulos se peleen por cerrar el worker. | Si `models/` fuera de otro equipo y cada cambio costara un PR cruzado. Acá el diff son ~20 líneas aditivas. |
| **`rag/infra/` importa `@qvac/sdk` y hace `loadModel`+`embed` solo** | Si `rag/` tuviera que ser un paquete separable, sin depender de `models/`. | **Acá es una trampa:** el SDK es **un worker compartido**. Si `rag/` llama `close()` por su cuenta, le mata la conexión al chat. Y el modelo quedaría cargado fuera del registro de `ModelManagementService`, así que `unloadAll()` en el shutdown no lo liberaría. |

**Excepción, a propósito:** `ragChunk()` **sí** se importa desde `rag/infra/qvacChunker.adapter.ts`. No es una operación de modelo — no recibe `modelId`, no carga nada, es una primitiva de texto puro (verificado en `dist/client/api/rag.d.ts`: su firma es `ragChunk(params)` sin `modelId`). Meterla en `ModelRuntimePort` ensuciaría un puerto que se llama "runtime **de modelos**" con algo que no lo es.

---

## Mapa de tareas

```
Tarea 0  rama + LÍNEA DE BASE ("antes") + dependencia + .gitignore
   │
   ├─ Tarea 1  embed() en el módulo models/            ← el motor
   ├─ Tarea 2  QvacEmbeddingAdapter (EmbeddingPort real, 768)
   │
   ├─ Tarea 3  LanceDbVectorStore: LEER (search)       ← el enchufe del ticket
   ├─ Tarea 4  LanceDbVectorStore: ESCRIBIR (add/delete)
   │
   ├─ Tarea 5  corpusReader: listar + hashear + ruta relativa
   ├─ Tarea 6  (eliminada: el estado de la ingesta vive en la propia tabla)
   ├─ Tarea 7  CorpusIngestService: el diff (el corazón del ticket)
   │
   ├─ Tarea 8  ingest.cli.ts + npm run ingest  → los 6 checks del DoD
   └─ Tarea 9  enchufar al RAG real (ragDemo + server.ts) + "después"
```

---

# Tarea 0: Rama, línea de base ("antes"), dependencia y `.gitignore`

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `.gitignore`
- Create (FUERA del repo, no se commitea): `$VERIF/preguntas-en.json`, `$VERIF/retrieval-eval.ts`, `$VERIF/tests-antes.txt`, `$VERIF/tsc-antes.txt`, `$VERIF/eval-antes.txt`

**Interfaces:**
- Consumes: nada.
- Produces: `@lancedb/lancedb@0.39.0` instalado; `.lancedb/` ignorado por git; la línea de base contra la que se comparan todas las tareas; `retrieval-eval.ts` (lo usa la Tarea 9 en modo `lance`).

### Contexto

Antes de una línea de código: una rama limpia desde `origin/main`. `feat/chat-api-integration` ya se mergeó (PR #17): no se trabaja sobre ella.

**Por qué una línea de base.** *Línea de base* = una foto de cómo está todo **antes** de tocar nada. `main` ya trae fallas que no son nuestras (3 archivos de test, 5 errores de tipos). Sin la foto, al final no se puede distinguir "esto lo rompí yo" de "esto ya estaba roto". Con la foto, la pregunta se vuelve mecánica: ¿apareció alguna línea nueva en el `diff`?

**Por qué medir la recuperación antes.** El ticket se trata de que el RAG encuentre el documento correcto del corpus real. Si solo medimos después, "8 de 10" no dice nada: no sabemos contra qué compararlo. Midiendo el store falso primero, tenemos el contraste.

### ⚖️ La decisión de este bloque: cómo medir para que el número sirva (revisión del 23/09)

La primera versión de este script medía con las 10 preguntas **en español** y 3 preguntas fuera del corpus **en inglés**. Tenía tres problemas, y los tres corrían `minScore` en la dirección equivocada:

1. **Idioma.** El corpus está en inglés y Tether va a preguntar en inglés. Una pregunta en español contra un texto en inglés da un *score* (el número de parecido) más bajo, aunque encuentre el archivo correcto. Calibrar con eso deja un umbral pensado para una situación que en la evaluación no pasa. **Ahora:** las 10 preguntas se traducen a inglés en `preguntas-en.json`. Las respuestas esperadas (`archivo`, `tambien_en`) se siguen leyendo del JSON original del lab, así hay una sola fuente de verdad.
2. **Pocas preguntas de control, y fáciles.** 3 preguntas genéricas (Marte, el Mundial, lasaña) casi no se parecen a nada del corpus. Las peligrosas son las que **suenan** a Meridian y no tienen respuesta (*"What was Meridian's total revenue in Q4 2025?"*: el corpus tiene Q1 y Q2 2026, así que es la trampa perfecta para inventar un número). **Ahora son 8:** 5 de ese tipo y las 3 genéricas. Se verificó con `grep` sobre `corpus/` que ninguna de las 5 tiene respuesta.
3. **Top 5 en vez de top 4.** `RagRetrievalService` le pasa al modelo como mucho `maxContextChunks = 4` fragmentos, y solo esos se pueden citar. Un acierto en el puesto 5 no le sirve a nadie. **Ahora `K = 4`.**

Y un cuarto, de honestidad del "antes": los fixtures guardan `source` sin carpeta (`'escalation-matrix.txt'`). Comparando la ruta completa, el store falso daba **0/10 por construcción**, no por medición. **Ahora**, en modo `fake`, se compara solo el nombre del archivo. El "antes" pasa a medir lo que de verdad importa: que el store falso tiene 6 fragmentos y no el corpus.

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **Preguntas en el idioma del evaluador** (elegida) | Cuando se calibra un umbral para una evaluación concreta: hay que medir en sus condiciones. | Si el producto tuviera que atender en varios idiomas: ahí se mide en cada uno y el umbral sale del peor. |
| **Preguntas en español** (la versión anterior) | Para medir cuánto aguanta el modelo multilingüe: es una prueba más dura del *ranking*. | Para fijar `minScore`: lo deja más bajo de lo que corresponde. |

**Alternativa descartada — commitear el script de evaluación como parte del producto (`npm run rag-eval`).** Tendría sentido si el equipo fuera a correrlo en CI o a tunear `chunkSize` seguido. Acá es verificación de este ticket, y el alcance acordado es "nada fuera del ticket". Vive en `qvac-lab/verificacion/` (fuera del repo).

`.lancedb/` se ignora porque son datos derivados: se regeneran con `npm run ingest`. Commitear 100 vectores de 768 floats es meter ~350 KB de binario en el repo que se desincroniza del corpus en cuanto alguien toca un `.md`.

### Bloques (~50 líneas cada uno)

- **Bloque A** — rama + línea de base de tests y tipos (Steps 1–2)
- **Bloque B** — `preguntas-en.json` (Step 3a) + `retrieval-eval.ts`, primera mitad: leer las preguntas y el modo `fake` (Step 3b)
- **Bloque C** — `retrieval-eval.ts`, segunda mitad: modo `lance` + el cálculo de aciertos (Step 3) y la corrida "antes" (Step 4)

- [ ] **Step 1: Crear la rama desde `origin/main`**

```bash
cd /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-practice-0916
git fetch origin
git switch -c feat/persistent-vector-store origin/main
git log --oneline -1
```

⚠️ **Antes de este paso:** hoy el working tree está en `feat/chat-api-integration` con dos archivos **staged** (este plan y `docs/2026-09-24-reunion-equipo-conflictos-merge.md`). `git switch -c` se los lleva staged a la rama nueva, y el `git commit` del Step 10 los metería en el commit de la dependencia. Commitearlos aparte o sacarlos del índice (`git restore --staged <archivo>`) antes de cambiar de rama. Verificar con `git status --short` que no quede nada staged.

Expected: `472e64e Update package-lock.json` (verificado el 23/09: el único commit posterior a `28d5335`, y solo toca `package-lock.json`). Si es otro más nuevo, **está bien** — pero antes de seguir, correr `git show --stat HEAD` y verificar que no toque `apps/backend/src/rag/`, `apps/backend/src/models/` ni `apps/backend/src/server.ts`. Si los toca, releer este plan contra el código nuevo antes de escribir nada.

- [ ] **Step 2: Tomar la línea de base de tests y tipos**

```bash
VERIF=/Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-lab/verificacion
mkdir -p $VERIF
npm run test --workspace=apps/backend 2>&1 | grep ' FAIL ' | sort -u > $VERIF/tests-antes.txt
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | grep 'error TS' | sort -u > $VERIF/tsc-antes.txt
cat $VERIF/tests-antes.txt $VERIF/tsc-antes.txt
```

Expected (medido el 23/09/2026 sobre `28d5335`): en `tests-antes.txt`, las líneas `FAIL` de `src/ai/context/fullCorpusContext.test.ts`, `src/ai/orchestrator/corpusContext.test.ts` y `src/ai/orchestrator/agentService.test.ts > AgentService.invoke > sends the corpus content...`; en `tsc-antes.txt`, 5 errores (`fullCorpusContext.test.ts` TS2307, `agentService.ts` TS6133, `corpusContext.test.ts` TS2307, `graph.ts` TS6133, `qvacChatModel.ts` TS6196). Si salen otros, **no importa**: la foto es la que sea, lo que importa es compararse contra ella.

**El comando de comparación** — el plan lo llama "comparar contra la línea de base" de acá en adelante:

```bash
VERIF=/Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-lab/verificacion
npm run test --workspace=apps/backend 2>&1 | grep ' FAIL ' | sort -u > $VERIF/tests-ahora.txt
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | grep 'error TS' | sort -u > $VERIF/tsc-ahora.txt
diff $VERIF/tests-antes.txt $VERIF/tests-ahora.txt && diff $VERIF/tsc-antes.txt $VERIF/tsc-ahora.txt && echo "OK: sin fallas nuevas"
```

Expected cada vez que se corra: `OK: sin fallas nuevas`. Una línea con `>` en el `diff` es una falla **nueva**, y es nuestra. Una línea con `<` es una falla que desapareció: está bien, pero hay que entender por qué antes de seguir.

- [ ] **Step 3a: Escribir las preguntas en inglés**

Create `/Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-lab/verificacion/preguntas-en.json`. Es una traducción fiel de `preguntas-eval.json` (mismo `id`, misma pregunta), **sin** copiar frases del documento que la responde: si la pregunta repite las palabras exactas del texto, el score sale inflado y la prueba se vuelve más fácil que la real.

```json
{
  "questions": {
    "1": "What is the first-response SLA for a P1 ticket (production down)?",
    "2": "What is the maximum discount an Account Executive can approve without additional approval?",
    "3": "Can we promise delivery of a ControLink Gateway rev C before August 15, 2026?",
    "4": "How long does a spare part take to reach the APAC region?",
    "5": "What was Meridian's NPS in the June 2026 pulse, and how many people responded?",
    "6": "According to the service SOP, what is the weakest field laptop the system has to support?",
    "7": "What is the standard warranty on a ServoDrive X4, and how much does it cost to extend it to 36 months?",
    "8": "Among the accounts on the Customer Success risk watchlist, which one has the lowest health score, and how much ARR does it represent?",
    "9": "What is the list price of a ControLink Gateway rev C, and what shipping restriction currently applies to it?",
    "10": "What was Meridian's recognized revenue in Q1 2026, and how did it compare to Q2?"
  },
  "offTopic": [
    "What is Meridian's parental leave policy?",
    "How many vacation days do Meridian employees get per year?",
    "Who is Meridian's CEO?",
    "What was Meridian's total revenue in Q4 2025?",
    "What is the maximum operating temperature of the ServoDrive X4?",
    "What is the weather on Mars?",
    "Who won the 2022 football World Cup?",
    "Give me a recipe for lasagna."
  ]
}
```

Las 5 primeras de `offTopic` suenan a Meridian y **no** tienen respuesta: verificado el 23/09 con `grep -ril` sobre `corpus/` buscando `parental`, `vacation`, `CEO`, `2025`, `temperature`: cero archivos. Si el corpus cambia, repetir ese `grep` antes de confiar en ellas.

- [ ] **Step 3b: Escribir el script de evaluación de recuperación**

Create `/Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-lab/verificacion/retrieval-eval.ts`:

```ts
/**
 * VERIFICACIÓN, no código del producto: vive fuera del repo a propósito.
 * Para cada pregunta pide los K chunks más parecidos y se fija si el archivo
 * que la responde está entre ellos. Las preguntas van en inglés
 * (preguntas-en.json), como las hace Tether; las respuestas esperadas salen
 * de preguntas-eval.json, la fuente de verdad del lab.
 *
 * Correr SIEMPRE desde apps/backend (el SDK busca qvac.config.mjs desde ahí):
 *   npx tsx ../../../qvac-lab/verificacion/retrieval-eval.ts fake
 *   npx tsx ../../../qvac-lab/verificacion/retrieval-eval.ts lance
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../qvac-practice-0916/apps/backend/src');
const mode = process.argv[2];
if (mode !== 'fake' && mode !== 'lance') throw new Error('uso: retrieval-eval.ts fake|lance');

/** = DEFAULT_RAG_CONFIG.maxContextChunks: lo que el modelo ve y lo único que se puede citar. */
const K = 4;

interface Question { id: number; archivo: string; tambien_en?: string[] }
interface EnglishSet { questions: Record<string, string>; offTopic: string[] }
interface Hit { source?: string; score: number }

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, 'utf8')) as T;
const questions = await readJson<Question[]>(path.join(here, '..', 'preguntas-eval.json'));
const english = await readJson<EnglishSet>(path.join(here, 'preguntas-en.json'));

// El JSON del lab usa el prefijo "corpus-real/"; el store guarda rutas relativas a la raíz del corpus.
// En modo fake se compara solo el nombre de archivo: los fixtures no traen carpeta, y
// comparando la ruta entera el "antes" daría 0 por construcción, no por medición.
const key = (p: string): string => (mode === 'fake' ? path.basename(p) : p.replace(/^corpus-real\//, ''));

let search: (query: string) => Promise<Hit[]>;
let cleanup = async (): Promise<void> => {};

if (mode === 'fake') {
  const { FakeEmbeddingPort } = await import(`${src}/rag/infra/fakeEmbedding.adapter.js`);
  const { buildFixtureVectorStore } = await import(`${src}/rag/infra/fixtures/corpus-chunks.fixture.js`);
  const port = new FakeEmbeddingPort();
  const store = await buildFixtureVectorStore(port);
  search = async (q) => store.search(await port.embed(q), { topK: K, minScore: -1 });
} else {
  const { QvacRuntimeAdapter } = await import(`${src}/models/infra/qvacRuntimeAdapter.js`);
  const { ModelManagementService } = await import(`${src}/models/service/models.service.js`);
  const { QvacEmbeddingAdapter } = await import(`${src}/rag/infra/qvacEmbedding.adapter.js`);
  const { LanceDbVectorStore } = await import(`${src}/rag/infra/lanceDbVectorStore.js`);
  const { VECTOR_DB_DIR } = await import(`${src}/config/rag.config.js`);
  const adapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(adapter, adapter);
  const embedding = new QvacEmbeddingAdapter(service);
  const store = await LanceDbVectorStore.open(VECTOR_DB_DIR);
  search = async (q) => store.search(await embedding.embed(q), { topK: K, minScore: -1 });
  cleanup = async () => {
    await embedding.unload();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await service.close();
  };
}

let hits = 0;
const correctScores: number[] = [];
try {
  for (const q of questions) {
    const text = english.questions[String(q.id)];
    if (!text) throw new Error(`preguntas-en.json no tiene la pregunta #${q.id}`);
    const expected = new Set([q.archivo, ...(q.tambien_en ?? [])].map(key));
    const results = await search(text);
    const rank = results.findIndex((r) => r.source !== undefined && expected.has(key(r.source)));
    if (rank >= 0) {
      hits += 1;
      correctScores.push(results[rank].score);
    }
    const top = results[0];
    console.log(`#${q.id} ${rank >= 0 ? `OK (puesto ${rank + 1}, ${results[rank].score.toFixed(4)})` : 'NO'} | top: ${top?.source} ${top?.score.toFixed(4)} | esperado: ${key(q.archivo)}`);
  }

  const A = correctScores.length ? Math.min(...correctScores) : Number.NaN;
  const noise = await Promise.all(english.offTopic.map(async (q) => ({ q, score: (await search(q))[0]?.score ?? -1 })));
  noise.sort((a, b) => b.score - a.score);

  console.log(`\nAciertos (archivo correcto en el top ${K}): ${hits}/${questions.length}`);
  console.log(`A = score más bajo de un chunk correcto: ${A.toFixed(4)}`);
  console.log('Mejor score de cada pregunta SIN respuesta en el corpus:');
  for (const n of noise) console.log(`  ${n.score.toFixed(4)}${n.score >= A ? '  <- pasaría un umbral en A' : ''} | ${n.q}`);
  console.log(`B = el más alto de esos: ${noise[0].score.toFixed(4)}`);
} finally {
  await cleanup();
}
```

> **Por qué `minScore: -1` y no `RagRetrievalService`:** acá medimos si **el ranking** encuentra el archivo, sin que el umbral esconda resultados. El umbral (`minScore`) se decide **después**, con `A`, `B` y la lista de las preguntas sin respuesta (Tarea 9, Step 4).
>
> **Por qué `import()` dinámico:** en el modo `fake`, los archivos `qvacEmbedding.adapter.ts` y `lanceDbVectorStore.ts` todavía no existen. Con un `import` normal arriba del archivo, el script no arrancaría ni en modo `fake`.
>
> **Por qué se imprime cada pregunta sin respuesta, y no solo el máximo:** con 8 preguntas, un solo número esconde si el problema es una pregunta rara o todas las que suenan a Meridian. La marca `<- pasaría un umbral en A` dice exactamente cuáles recibirían contexto con el umbral más permisivo posible.

- [ ] **Step 4: Correr la evaluación "antes" (store falso)**

```bash
cd apps/backend
npx tsx ../../../qvac-lab/verificacion/retrieval-eval.ts fake | tee ../../../qvac-lab/verificacion/eval-antes.txt
cd ../..
```

Expected: `Aciertos (archivo correcto en el top 4)` **como mucho 5/10**. Anotar el número que salga, sea cual sea. Cómo leerlo:
- Las preguntas **2, 3, 5, 6 y 8** fallan seguro: su archivo no está entre los 6 fixtures. Es el "antes" de verdad: **al store falso le falta el corpus**.
- Las **1, 4, 7, 9 y 10** pueden acertar, pero no es mérito del ranking. El store tiene 6 fragmentos y devuelve 4, así que casi cualquier pregunta se lleva dos tercios del store.

Esto es el "antes" del ticket, medido y contado como es. En el PR se reporta así, no como "0 → N".

Si `tsx` no resuelve los imports dinámicos con ruta absoluta (error `Cannot find module .../fakeEmbedding.adapter.js`), cambiar `.js` por `.ts` en todos los `import(...)` del script — es una diferencia de cómo resuelve `tsx` las rutas absolutas, no un problema del plan.

- [ ] **Step 5: "Antes" en la app real — una pregunta que los fixtures no cubren**

En una terminal: `npm run dev:server`. En otra:

```bash
curl -s -X POST localhost:3001/api/chat/preload
until curl -s localhost:3001/api/chat/status | grep -q '"ready"'; do sleep 3; done
curl -sN -X POST localhost:3001/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"What is the maximum discount an Account Executive can approve without additional approval?"}]}' \
  | tee /Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-lab/verificacion/app-antes.txt
```

Expected: la respuesta **no** dice "10%" apoyándose en el corpus. Los 6 fixtures no tienen nada de descuentos, y `emails/014-discount-authority.md` nunca entró al store. Puede inventar, negarse o contestar en general: cualquiera de esas cosas es el "antes". Cortar el servidor con Ctrl+C.

> La primera vez, el `preload` descarga el modelo de chat (~1,1 GB) si no está en `.qvac-cache`. Es la misma descarga que ya hace el front.

- [ ] **Step 6: Instalar LanceDB en la versión exacta**

```bash
npm install --save-exact --workspace=apps/backend @lancedb/lancedb@0.39.0
```

- [ ] **Step 7: Verificar que el binario nativo de esta plataforma quedó instalado**

```bash
node -e "const l=require('@lancedb/lancedb'); console.log(typeof l.connect)"
```

Expected: `function`. Si tira `Cannot find module '@lancedb/lancedb-darwin-arm64'`, el paquete opcional de la plataforma no bajó — repetir el install sin `--no-optional`.

- [ ] **Step 8: Agregar el script `ingest` a `apps/backend/package.json`**

En `"scripts"`, junto a `"rag-demo"`:

```json
    "ingest": "tsx src/rag/ingest/ingest.cli.ts",
```

- [ ] **Step 9: Ignorar la carpeta de la base vectorial**

⚠️ **`.gitignore` de `origin/main` NO termina en salto de línea** (verificado con `od -c`: el último byte es la `o` de `*.tsbuildinfo`). Un `echo '.lancedb/' >> .gitignore` produciría la línea `*.tsbuildinfo.lancedb/`, que no ignora nada y rompe la regla anterior. Usar esto, que agrega el salto faltante primero:

```bash
printf '\n.lancedb/\n' >> .gitignore
```

Verificar que quedó bien:

```bash
tail -3 .gitignore && git check-ignore -v .lancedb/ 2>/dev/null || echo "OJO: .lancedb/ NO esta siendo ignorado"
```

Expected: `*.tsbuildinfo` y `.lancedb/` en líneas separadas.

- [ ] **Step 10: Commit**

```bash
git add .gitignore apps/backend/package.json package-lock.json
git commit -m "chore: add LanceDB dependency and ingest script"
```

---

# Tarea 1: `embed()` en el módulo `models/`

**Files:**
- Modify: `apps/backend/src/models/domain/ports.ts`
- Modify: `apps/backend/src/models/infra/qvacRuntimeAdapter.ts`
- Modify: `apps/backend/src/models/service/models.service.ts`
- Test: `apps/backend/src/models/service/models.service.test.ts` (modificar el fake + agregar casos)
- Modify: `apps/backend/src/ai/orchestrator/agentService.test.ts` (su propio `FakeModelRuntime` también implementa el puerto)

**Interfaces:**
- Consumes: `ModelManagementService`, `QvacRuntimeAdapter`, `ModelRuntimePort` (ya existentes).
- Produces:
  - `ModelRuntimePort.embed(modelId: string, texts: string[]): Promise<number[][]>`
  - `ModelManagementService.embed(modelId: string, texts: string[]): Promise<number[][]>` — tira `ModelManagementError` con stage `'not-found'` si el modelo no está cargado.

### Contexto

**Qué construyo:** la capacidad de embeber en el módulo que ya maneja modelos.

**Por qué:** `embed()` del SDK necesita un `modelId`, que solo existe después de un `loadModel()`. Ese ciclo de vida ya lo maneja `ModelManagementService`. Duplicarlo en `rag/` significaría dos dueños del mismo worker.

**Decisión de diseño — la API recibe `string[]`, siempre, nunca `string`.** El SDK acepta las dos formas y **devuelve formas distintas**: `number[]` para un string suelto, `number[][]` para un array. Aceptar las dos en nuestro puerto significa que cada consumidor tiene que ramificar. Aceptar solo el array significa que el tipo de retorno es siempre `number[][]` y la rama vive en un solo lugar (el adaptador).

**Por qué el batch importa de verdad:** cada llamada es un viaje por **RPC** al worker de QVAC. *RPC* = "llamada a procedimiento remoto": tu código le pide algo a otro proceso y espera; el viaje de ida y vuelta cuesta, aunque el trabajo sea chico. Un viaje con 8 chunks es mucho más barato que 8 viajes con 1 chunk. Con 100 chunks la diferencia es de segundos.

**Alternativa descartada:** exponer `embed()` con la convención `Promise<T> & { requestId }` que usan `load()` e `infer()`, para poder cancelarlo. Serviría si embeber fuera largo y el usuario pudiera arrepentirse — en un endpoint interactivo, por ejemplo. Acá embeber corre en un CLI que el usuario ya decidió correr, y cada llamada tarda milisegundos. Agregar el registro de requests sería complejidad sin caso de uso.

**Diferencia con el proyecto real:** ninguna, esto **es** el proyecto real.

### Bloques (~50 líneas cada uno)

- **Bloque A** — el método en `ModelRuntimePort` (Steps 1–2)
- **Bloque B** — la implementación en `QvacRuntimeAdapter` + `normalizeEmbeddings` (Steps 3–5)
- **Bloque C** — el método en `ModelManagementService` + los tests (Steps 6–9)

---

- [ ] **Step 1: Escribir el test que falla (el fake todavía no tiene `embed`)**

En `apps/backend/src/models/service/models.service.test.ts`, agregar al final del `describe` principal:

```ts
  it('embeds texts with a loaded model, one vector per input', async () => {
    const runtime = new FakeModelRuntime();
    const service = new ModelManagementService(runtime, runtime);
    const load = service.loadModel({ kind: 'registry', registryPath: 'p', registrySource: 'hf' });
    runtime.settle(load.requestId);
    const { modelId } = await load;

    const vectors = await service.embed(modelId, ['hola', 'chau']);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toEqual([1, 0, 0]);
    expect(vectors[1]).toEqual([0, 1, 0]);
  });

  it('refuses to embed with a model that is not loaded', async () => {
    const runtime = new FakeModelRuntime();
    const service = new ModelManagementService(runtime, runtime);

    await expect(service.embed('never-loaded', ['hola'])).rejects.toBeInstanceOf(ModelManagementError);
  });
```

> `runtime.settle(requestId)` ya existe en `FakeModelRuntime` — es el "test hook" que resuelve una llamada en vuelo con su resultado normal (verificado en `models.service.test.ts` de `origin/main`). No hay que escribirlo.

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npm run test --workspace=apps/backend -- models.service`
Expected: FAIL — `Property 'embed' does not exist on type 'ModelManagementService'`.

- [ ] **Step 3: Agregar `embed()` a `ModelRuntimePort`**

En `apps/backend/src/models/domain/ports.ts`, dentro de `interface ModelRuntimePort`, después de `chatComplete`:

```ts
  /**
   * Embeds a batch of texts with an already-loaded embeddings model,
   * returning one vector per input **in input order**. Always a batch, never
   * a single string: the underlying SDK returns a different shape for each
   * (`number[]` vs `number[][]`), and collapsing that difference here keeps
   * every consumer from having to branch on it. One call is one RPC round
   * trip, so callers should batch rather than loop.
   */
  embed(modelId: string, texts: string[]): Promise<number[][]>;
```

- [ ] **Step 4: Implementarlo en `QvacRuntimeAdapter`**

En `apps/backend/src/models/infra/qvacRuntimeAdapter.ts`:

1. En el `import` de `@qvac/sdk`, agregar `embed as sdkEmbed,` (alias, para que no choque con el nombre del método).
2. Dentro de la clase, después de `chatComplete()`:

```ts
  async embed(modelId: string, texts: string[]): Promise<number[][]> {
    // Without this, `[]` comes back as a default `[]` embedding, which
    // `toVectorBatch` reads as ONE flat vector and rejects with a confusing
    // "returned 1 vectors for 0 inputs".
    if (texts.length === 0) return [];
    const { embedding } = await sdkEmbed({ modelId, text: texts });
    return toVectorBatch(embedding, texts.length);
  }
```

3. Al final del archivo, junto a los otros helpers:

```ts
/**
 * `embed()`'s response is typed `number[] | number[][]` (see
 * `dist/schemas/embed.d.ts`): the SDK returns one flat vector when `text` is
 * a string and one vector per input when it's an array. We always pass an
 * array, but a one-element array is exactly where the two shapes are easiest
 * to confuse, so the shape is checked at runtime instead of assumed. The
 * length check turns a silent misalignment - vectors landing on the wrong
 * chunks, which would only surface much later as nonsense citations - into
 * an immediate, loud failure.
 */
function toVectorBatch(embedding: number[] | number[][], expected: number): number[][] {
  const vectors: number[][] = Array.isArray(embedding[0])
    ? (embedding as number[][])
    : [embedding as number[]];

  if (vectors.length !== expected) {
    throw new Error(`embed() returned ${vectors.length} vectors for ${expected} inputs`);
  }

  return vectors;
}
```

- [ ] **Step 5: Hacer que los DOS fakes de test implementen `embed()`**

Agregar un método a una interfaz rompe a todos los que la implementan. En `main` hay **dos** `FakeModelRuntime implements ... ModelRuntimePort` (verificado con `git grep -n "implements.*ModelRuntimePort" -- apps/backend/src`):

**a)** En `models.service.test.ts`, dentro de `class FakeModelRuntime`, después de `chatComplete()`:

```ts
  /** One-hot vectors: input i gets a 1 in position i. Deterministic and trivially assertable. */
  async embed(_modelId: string, texts: string[]): Promise<number[][]> {
    return texts.map((_text, index) =>
      Array.from({ length: 3 }, (_zero, position) => (position === index ? 1 : 0))
    );
  }
```

**b)** En `apps/backend/src/ai/orchestrator/agentService.test.ts`, dentro de `class FakeModelRuntime`, después de `chatComplete()` (mismo estilo corto que el resto de ese fake):

```ts
  async embed(_modelId: string, texts: string[]): Promise<number[][]> {
    return texts.map(() => [1]);
  }
```

**Ojo:** vitest **no** chequea tipos. Sin (b), los tests siguen pasando igual, y el error aparece recién en `tsc`, en el Step 8. Antes de dar el paso por cerrado, repetir el grep por si apareció un implementador nuevo.

- [ ] **Step 6: Agregar `embed()` a `ModelManagementService`**

En `apps/backend/src/models/service/models.service.ts`, después de `chatComplete()`:

```ts
  /**
   * Embeds a batch of texts with an already-loaded embeddings model. Same
   * `assertLoaded` + error-translation contract as `chatComplete()`: one
   * `ModelManagementError` for callers to handle, tagged with the stage that
   * failed.
   */
  async embed(modelId: string, texts: string[]): Promise<number[][]> {
    this.assertLoaded(modelId);
    try {
      return await this.runtime.embed(modelId, texts);
    } catch (err) {
      throw toModelManagementError('inference', err);
    }
  }
```

- [ ] **Step 7: Correr los tests y confirmar que pasan**

Run: `npm run test --workspace=apps/backend -- models.service`
Expected: PASS, incluidos los 2 casos nuevos.

- [ ] **Step 8: Comparar contra la línea de base (tests + tipos)**

Correr el comando de comparación de la Tarea 0, Step 2.
Expected: `OK: sin fallas nuevas`. Si el `diff` muestra `> ... Class 'X' incorrectly implements interface 'ModelRuntimePort'`, hay otro implementador de ese puerto sin `embed()`: agregárselo.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/models apps/backend/src/ai/orchestrator/agentService.test.ts
git commit -m "feat(models): add batch embed to the model runtime port and service"
```

---

# Tarea 2: `QvacEmbeddingAdapter` — el `EmbeddingPort` real

**Files:**
- Create: `apps/backend/src/rag/infra/qvacEmbedding.adapter.ts`
- Test: `apps/backend/src/rag/infra/qvacEmbedding.adapter.test.ts`
- Modify: `apps/backend/src/rag/domain/ports.ts`
- Modify: `apps/backend/src/rag/infra/fakeEmbedding.adapter.ts`
- Modify: `apps/backend/src/config/models.config.ts`
- Create: `apps/backend/src/config/rag.config.ts`

**Interfaces:**
- Consumes: `ModelManagementService.embed(modelId, texts)` (Tarea 1).
- Produces:
  - `EmbeddingPort.embedBatch(texts: string[]): Promise<number[][]>` (nuevo método del puerto existente)
  - `class QvacEmbeddingAdapter implements EmbeddingPort` — constructor `(service: ModelManagementService, source: ModelSource = EMBEDDING_MODEL_SOURCE)`; métodos `embed(text)`, `embedBatch(texts)`, `ensureModel(): Promise<string>`, `unload(): Promise<void>`
  - `EMBEDDING_MODEL_SOURCE: ModelSource` en `config/models.config.ts`
  - `EMBEDDING_DIMENSIONS = 768`, `CORPUS_ROOT`, `VECTOR_DB_DIR`, `CHUNKS_TABLE`, `TEXT_EXTENSIONS`, `CHUNK_OPTIONS` en `config/rag.config.ts`

### Contexto

**Qué construyo:** el adaptador que convierte texto en los 768 números de EmbeddingGemma, detrás del `EmbeddingPort` que ya existe.

**Por qué:** `RagRetrievalService` pide `embeddingPort.embed(query)`. Hoy le contesta un fake que cuenta palabras. Enchufar el real acá hace que *nada más* tenga que cambiar.

**Decisión de diseño 1 — carga perezosa (`ensureModel`), y reintentable.** El adaptador no carga el modelo en el constructor: lo carga la primera vez que se le pide un embedding, y después lo recuerda. Construir un objeto no debería descargar 277 MB. **Si la carga falla, se olvida el intento fallido** para que la llamada siguiente vuelva a probar. Es el mismo patrón que ya usa `ChatQVAC.ensureModel()` en `main` (`ai/orchestrator/qvacChatModel.ts`). Sin eso, una descarga cortada una vez dejaría el adaptador roto hasta reiniciar el proceso, y en el servidor, que vive horas, eso significa que todas las preguntas fallan.

**Decisión de diseño 2 — el `modelType` viaja en el `ModelSource`.** `QvacRuntimeAdapter.load()` usa `DEFAULT_MODEL_TYPE = 'llamacpp-completion'` cuando el source no trae `modelType`. Para un modelo de embeddings eso carga el motor equivocado. Poner `modelType: 'llamacpp-embedding'` en la constante, y no como parámetro suelto, hace que sea imposible olvidárselo en un call site.

**Decisión de diseño 3 — `embedBatch` se agrega al puerto, no se crea un puerto nuevo.** Un puerto con dos métodos que hacen lo mismo con distinta cardinalidad es normal; dos puertos para el mismo concepto obligan a inyectar dos cosas donde antes había una.

**Alternativa descartada — normalizar los vectores a mano (dividir por su norma L2).** Sería necesario si buscáramos por producto interno. LanceDB con `distanceType('cosine')` normaliza internamente, así que la salida cruda del modelo sirve tal cual. Si algún día se cambia a `'dot'` por velocidad, ahí sí hay que normalizar al escribir.

**⚠️ Trampa del proyecto que este adaptador expone.** `CLAUDE.md` dice *"un solo modelo en RAM por vez"*. Contestar una pregunta necesita **dos**: el de embeddings (para la pregunta) y el de chat (para la respuesta). Descargar y cargar en cada turno haría el chat inusable. Decisión: **conviven los dos**. EmbeddingGemma Q4 pesa 277 MB y el modelo de chat ~1,1 GB; entran en la máquina de 8 GB del target. Este adaptador expone `unload()` para que el CLI de ingesta libere el modelo cuando termina — el CLI sí es un proceso de un solo modelo.

### Bloques (~50 líneas cada uno)

- **Bloque A** — `config/rag.config.ts` + `EMBEDDING_MODEL_SOURCE` (Steps 3–4)
- **Bloque B** — `embedBatch` en el puerto y en el fake (Steps 5–6)
- **Bloque C** — `QvacEmbeddingAdapter` (Step 7)
- **Bloque D** — verificación real contra el modelo (Steps 9–10)

---

- [ ] **Step 1: Escribir el test que falla**

Create `apps/backend/src/rag/infra/qvacEmbedding.adapter.test.ts`:

```ts
import { describe, expect, it, vi, type Mock } from 'vitest';
import { QvacEmbeddingAdapter } from './qvacEmbedding.adapter.js';
import type { ModelManagementService } from '../../models/service/models.service.js';
import type { ModelSource } from '../../models/domain/types.js';

const SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: 'p',
  registrySource: 'hf',
  modelType: 'llamacpp-embedding'
};

/** Minimal stand-in for `ModelManagementService`: only the two methods the adapter touches. */
function fakeService() {
  const loadModel = vi.fn(() =>
    Object.assign(Promise.resolve({ modelId: 'emb-1', source: SOURCE, loadedAt: new Date() }), {
      requestId: 'req-1'
    })
  );
  const embed = vi.fn(async (_modelId: string, texts: string[]) => texts.map((_t, i) => [i, i + 1]));
  const unloadModel = vi.fn(async () => {});
  return { loadModel, embed, unloadModel } as unknown as ModelManagementService;
}

describe('QvacEmbeddingAdapter', () => {
  it('loads the model once and reuses it across calls', async () => {
    const service = fakeService();
    const adapter = new QvacEmbeddingAdapter(service, SOURCE);

    await adapter.embedBatch(['a']);
    await adapter.embedBatch(['b']);

    expect(service.loadModel).toHaveBeenCalledTimes(1);
  });

  it('returns one vector per input, in input order', async () => {
    const adapter = new QvacEmbeddingAdapter(fakeService(), SOURCE);

    expect(await adapter.embedBatch(['a', 'b', 'c'])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it('embed() unwraps the single-element batch', async () => {
    const adapter = new QvacEmbeddingAdapter(fakeService(), SOURCE);

    expect(await adapter.embed('a')).toEqual([0, 1]);
  });

  it('embedBatch([]) short-circuits without loading the model', async () => {
    const service = fakeService();
    const adapter = new QvacEmbeddingAdapter(service, SOURCE);

    expect(await adapter.embedBatch([])).toEqual([]);
    expect(service.loadModel).not.toHaveBeenCalled();
  });

  it('retries the load if the first attempt failed', async () => {
    const service = fakeService();
    const loadModel = service.loadModel as unknown as Mock;
    loadModel.mockImplementationOnce(() =>
      Object.assign(Promise.reject(new Error('download interrupted')), { requestId: 'req-0' })
    );
    const adapter = new QvacEmbeddingAdapter(service, SOURCE);

    await expect(adapter.embedBatch(['a'])).rejects.toThrow('download interrupted');
    expect(await adapter.embedBatch(['a'])).toEqual([[0, 1]]);
    expect(loadModel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm run test --workspace=apps/backend -- qvacEmbedding`
Expected: FAIL — `Failed to resolve import "./qvacEmbedding.adapter.js"`.

- [ ] **Step 3: Crear `apps/backend/src/config/rag.config.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
/** `src/config` -> `src` -> `backend` -> `apps` -> repo root. */
const repoRoot = path.resolve(configDir, '..', '..', '..', '..');

/**
 * Corpus root as shipped in `corpus.zip`. Every `source` stored in the
 * vector table is relative to THIS directory - the challenge requires
 * citations to carry corpus-relative paths ("reports/x.md", never
 * "corpus/reports/x.md" and never an absolute path), and this constant is
 * the single place that defines what "relative to the corpus root" means.
 */
export const CORPUS_ROOT = path.join(repoRoot, 'corpus');

/** File-backed LanceDB directory. Derived data: gitignored, rebuilt by `npm run ingest`. */
export const VECTOR_DB_DIR = path.join(repoRoot, '.lancedb');

export const CHUNKS_TABLE = 'chunks';

/** Text file extensions ingested from the corpus. `corpus/pictures/` is skipped: `ragChunk()` does not process binaries. */
export const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html', '.json', '.csv']);

/**
 * Chunking options passed to `ragChunk()`. `chunkSize: 600` was chosen in
 * Lab 4 after comparing 150 / 600 / 2000 against the real corpus - 150 gave
 * a BETTER raw distance score but all 3 top results came from the same
 * document (the winning phrase cut mid-sentence); 600 gave the 3 top
 * results from 3 different files, a more useful answer even at a worse
 * score. A qualitative choice, backed by one measured comparison - not yet
 * validated with a `recall@k` sweep across the full `preguntas-eval.json`
 * set - that sweep is future work, not covered by this plan.
 */
export const CHUNK_OPTIONS = {
  chunkSize: 600,
  chunkOverlap: 100,
  chunkStrategy: 'paragraph',
  splitStrategy: 'character'
} as const;

/**
 * Output dimension of `EMBEDDINGGEMMA_300M_Q4_0`, measured in Lab 3. The
 * challenge requires the store's vector dimension to match the embedding
 * model's; `CorpusIngestService` asserts the first real vector against this
 * number rather than trusting it, so a model swap fails loudly at ingest
 * instead of silently writing a table nothing can query.
 */
export const EMBEDDING_DIMENSIONS = 768;
```

- [ ] **Step 4: Reemplazar el placeholder de embeddings en `config/models.config.ts`**

Borrar el bloque `EMBEDDINGGEMMA_300M_Q4_0_MODEL_NAME` (con su comentario, que dice que todavía no hay adaptador) y poner en su lugar, en la sección "Embeddings models":

```ts
/** The only embeddings engine this backend targets. Must be set explicitly: `QvacRuntimeAdapter.load()` falls back to `DEFAULT_MODEL_TYPE` ('llamacpp-completion') otherwise, which loads the wrong engine for an embeddings model. */
export const EMBEDDING_MODEL_TYPE = 'llamacpp-embedding';

/**
 * Embedding model backing the RAG pipeline: EmbeddingGemma 300M, Q4_0,
 * ~277MB on disk, 768-dimensional output (measured, see
 * `EMBEDDING_DIMENSIONS` in `rag.config.ts`). Already preloaded in
 * `qvac.config.json` as "embeddinggemma-300m-q4-0". Now consumed by
 * `rag/infra/qvacEmbedding.adapter.ts`, so it's imported as a real catalog
 * constant rather than kept as a name string.
 */
export const EMBEDDING_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: EMBEDDINGGEMMA_300M_Q4_0.registryPath,
  registrySource: EMBEDDINGGEMMA_300M_Q4_0.registrySource,
  modelType: EMBEDDING_MODEL_TYPE
};
```

Y agregar `EMBEDDINGGEMMA_300M_Q4_0,` al `import { ... } from '@qvac/sdk'` de arriba del archivo (ordenado alfabéticamente: va antes de `MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K`).

- [ ] **Step 5: Agregar `embedBatch` a `EmbeddingPort`**

En `apps/backend/src/rag/domain/ports.ts`, reemplazar `interface EmbeddingPort` por:

```ts
export interface EmbeddingPort {
  /** Embeds a single text - the query side of retrieval. */
  embed(text: string): Promise<number[]>;
  /**
   * Embeds many texts at once, returning one vector per input **in input
   * order** - the ingestion side. Separate from `embed()` because the real
   * adapter sends one RPC round trip per call: embedding 100 chunks one by
   * one costs 100 trips, batching costs one.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

- [ ] **Step 6: Agregar `embedBatch` a TODOS los implementadores existentes de `EmbeddingPort`**

Agregar un método a una interfaz rompe a todos los que la implementan. En `origin/main` hay **dos**, verificado con `git grep "implements EmbeddingPort"`:

**a)** `apps/backend/src/rag/infra/fakeEmbedding.adapter.ts`, dentro de la clase:

```ts
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
```

**b)** `apps/backend/src/rag/service/rag.service.test.ts`, en la `class FakeEmbedding` (línea 6):

```ts
class FakeEmbedding implements EmbeddingPort {
  async embed(_text: string): Promise<number[]> {
    return [1];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1]);
  }
}
```

Sin (b), `npx tsc --noEmit` falla con `Class 'FakeEmbedding' incorrectly implements interface 'EmbeddingPort'`. Antes de dar el paso por cerrado, volver a correr el grep por si apareció un implementador nuevo:

```bash
git grep -n "implements EmbeddingPort" -- apps/backend/src
```

- [ ] **Step 7: Escribir `apps/backend/src/rag/infra/qvacEmbedding.adapter.ts`**

```ts
import type { EmbeddingPort } from '../domain/ports.js';
import type { ModelSource } from '../../models/domain/types.js';
import type { ModelManagementService } from '../../models/service/models.service.js';
import { EMBEDDING_MODEL_SOURCE } from '../../config/models.config.js';

/**
 * Real `EmbeddingPort`, backed by a QVAC embeddings model through
 * `ModelManagementService` - it never imports `@qvac/sdk` itself, so the
 * SDK stays behind `models/infra/qvacRuntimeAdapter.ts` and the model's
 * lifecycle stays registered with the one service that owns `unloadAll()`
 * and `close()`.
 *
 * The model loads lazily on first use and is then reused: constructing this
 * adapter must not trigger a ~277MB download. `loadPromise` (not a
 * `modelId` string) is what's memoized, so two concurrent first calls await
 * the same load instead of racing into two. A FAILED load is forgotten, so
 * the next call retries - same pattern as `ChatQVAC.ensureModel()`.
 */
export class QvacEmbeddingAdapter implements EmbeddingPort {
  private loadPromise?: Promise<string>;

  constructor(
    private readonly service: ModelManagementService,
    private readonly source: ModelSource = EMBEDDING_MODEL_SOURCE
  ) {}

  /** Loads the embeddings model if needed and returns its `modelId`. Idempotent and safe to call concurrently. */
  async ensureModel(): Promise<string> {
    this.loadPromise ??= this.service
      .loadModel(this.source)
      .then((loaded) => loaded.modelId)
      .catch((error: unknown) => {
        // Forget the failed attempt so the next call retries. Otherwise one
        // interrupted download would leave this adapter broken until the
        // process restarts - and the server process lives for hours.
        this.loadPromise = undefined;
        throw error;
      });
    return this.loadPromise;
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Short-circuited before `ensureModel()` on purpose: an empty ingest run
    // should not download or load a model to produce an empty answer.
    if (texts.length === 0) return [];

    const modelId = await this.ensureModel();
    return this.service.embed(modelId, texts);
  }

  /**
   * Releases the embeddings model. For the ingest CLI, which is done with
   * it once the table is written; the long-running server keeps it loaded
   * alongside the chat model instead, since swapping models per question
   * would make replies unusably slow. Safe to call when nothing was loaded.
   */
  async unload(): Promise<void> {
    if (!this.loadPromise) return;
    const modelId = await this.loadPromise;
    this.loadPromise = undefined;
    await this.service.unloadModel(modelId);
  }
}
```

- [ ] **Step 8: Correr los tests y confirmar que pasan**

Run: `npm run test --workspace=apps/backend -- qvacEmbedding`
Expected: PASS, los 5 casos.

- [ ] **Step 9: Verificación REAL contra el modelo (no es un test automatizado)**

Este paso descarga 277 MB la primera vez y tarda. Correr:

```bash
cd apps/backend && npx tsx -e "
import { QvacRuntimeAdapter } from './src/models/infra/qvacRuntimeAdapter.js';
import { ModelManagementService } from './src/models/service/models.service.js';
import { QvacEmbeddingAdapter } from './src/rag/infra/qvacEmbedding.adapter.js';
const a = new QvacRuntimeAdapter();
const s = new ModelManagementService(a, a);
const e = new QvacEmbeddingAdapter(s);
const v = await e.embedBatch(['warranty terms', 'stock levels']);
console.log('vectores:', v.length, '| dimension:', v[0].length);
await e.unload();
await new Promise((r) => setTimeout(r, 150));
await s.close();
"
```

Expected: `vectores: 2 | dimension: 768`.
**Si la dimensión no es 768**, actualizar `EMBEDDING_DIMENSIONS` en `rag.config.ts` con el número real antes de seguir — la Tarea 3 crea la tabla con ese número.

Después, correr el comando de comparación de la Tarea 0, Step 2. Expected: `OK: sin fallas nuevas`.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/rag apps/backend/src/config
git commit -m "feat(rag): add real QVAC embedding adapter and rag config"
```

---

# Tarea 3: `LanceDbVectorStore` — el lado de LECTURA

**Files:**
- Create: `apps/backend/src/rag/infra/lanceDbVectorStore.ts`
- Test: `apps/backend/src/rag/infra/lanceDbVectorStore.test.ts`
- Modify: `apps/backend/src/rag/domain/types.ts`

**Interfaces:**
- Consumes: `RetrievedChunk`, `VectorStorePort` (existentes); `CHUNKS_TABLE` (Tarea 2).
- Produces:
  - `ChunkRecord` en `rag/domain/types.ts`
  - `class LanceDbVectorStore implements VectorStorePort` — `static open(dbDir: string, tableName?: string): Promise<LanceDbVectorStore>`, `search(embedding, { topK, minScore })`
  - `static exists(dbDir: string, tableName?: string): Promise<boolean>`

### Contexto

**Qué construyo:** el enchufe que el comentario de `inMemoryVectorStore.ts:31` pide textualmente. La mitad de lectura.

**Por qué separo lectura de escritura en dos tareas:** el servidor **solo lee**. El CLI de ingesta **lee y escribe**. Si el store fuera un solo puerto gordo, el servidor tendría acceso a `delete()` sin necesitarlo. Además, esta tarea sola ya es revisable: "¿busca bien contra una tabla en disco?" es una pregunta que se contesta sin hablar de ingesta.

**Decisión de diseño 1 — la fila es PLANA, sin objetos anidados.** LanceDB infiere el esquema de la tabla a partir de las primeras filas. Un campo `metadata: { title, documentType }` se infiere como un *struct* de Arrow anidado, que es más frágil y más molesto de filtrar. Guardamos `title` y `documentType` como columnas sueltas y **reconstruimos** el `metadata` de `RetrievedChunk` al leer. El formato interno de la tabla es asunto de `infra/`; el dominio no se entera.

**Decisión de diseño 2 — `distanceType('cosine')`.** LanceDB por defecto usa **distancia L2** (la distancia "en línea recta"). Para embeddings, lo que importa es la *dirección* del vector, no su largo — dos textos que dicen lo mismo con distinto énfasis apuntan al mismo lado pero con distinta magnitud. Eso es **coseno**. Además:

- `score = 1 - _distance` convierte la distancia de LanceDB (menos es mejor) a la misma escala de similitud coseno que ya usa `InMemoryVectorStore` (más es mejor, rango [-1, 1]).
- Eso hace que `minScore` de `RagRetrievalConfig` **signifique lo mismo** con los dos stores. Si mezcláramos escalas, el mismo número de config significaría cosas distintas según el adaptador: el peor tipo de bug, porque no rompe nada, solo empeora los resultados.

| Métrica | Cuándo conviene | Cuándo no |
|---|---|---|
| **cosine** (elegida) | Embeddings de texto sin normalizar. Ignora la magnitud. | Si los vectores ya vinieran L2-normalizados, `dot` da lo mismo y es más rápido. |
| **l2** (default de LanceDB) | Datos donde la magnitud sí es señal (coordenadas, señales). | **Acá es una trampa**: es el default, así que si no se pasa nada "funciona" — pero rankea distinto y el `minScore` de la config queda sin sentido. |
| **dot** | Vectores garantizados normalizados; es la más barata. | Requiere normalizar al escribir. Una fila sin normalizar rompe el ranking en silencio. |

**Decisión de diseño 3 — `open()` estático en vez de constructor async.** Un constructor no puede ser `async`, y abrir la tabla es I/O. El patrón `static open()` deja el objeto siempre en estado válido: si existe, la tabla está abierta.

**Alternativa descartada:** abrir la conexión en cada `search()`. Sería lo correcto si hubiera muchos procesos compitiendo. Acá el servidor es uno solo y vive horas: reabrir en cada pregunta es I/O regalado.

**Diferencia con el proyecto real:** ninguna. Esto es el adaptador de producción.

### Bloques (~50 líneas cada uno)

- **Bloque A** — `ChunkRecord` + el test con una tabla temporal (Steps 1–2)
- **Bloque B** — `open`/`exists` + el mapeo de fila a `RetrievedChunk` (Step 3, primera mitad)
- **Bloque C** — `search()` con `distanceType` y el filtro por `minScore` (Step 3, segunda mitad)

---

- [ ] **Step 1: Agregar `ChunkRecord` a `rag/domain/types.ts`**

Al final del archivo:

```ts
/**
 * One chunk as it is written to and read back from the vector store. Unlike
 * `RetrievedChunk` (the retrieval-time view, which carries a score and no
 * vector) this is the storage view: it carries the embedding and the
 * document-level `contentHash`.
 *
 * `source` is the document's path **relative to the corpus root** - the
 * value that ends up in a citation, and the key `VectorStoreWriterPort`
 * deletes by when a document is re-ingested.
 */
export interface ChunkRecord {
  /** `${source}#${chunkIndex}` - stable across re-ingests of unchanged content. */
  id: string;
  content: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
  /** Human-readable document name, surfaced in the grounded-context header. */
  title: string;
  /** Corpus top-level folder: 'reports', 'emails', 'policies', ... */
  documentType: string;
  /** SHA-256 of the WHOLE source document (not this chunk). This column IS the ingest state: the ingest compares it with the file on disk to decide whether to re-embed. */
  contentHash: string;
}
```

- [ ] **Step 2: Escribir el test que falla**

Create `apps/backend/src/rag/infra/lanceDbVectorStore.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { LanceDbVectorStore } from './lanceDbVectorStore.js';

/**
 * Runs against a real LanceDB directory in a temp folder, not a mock: the
 * whole point of this adapter is the on-disk behaviour (schema inference,
 * cosine distance, `_distance` semantics), and a mock would assert our
 * assumptions about LanceDB rather than LanceDB itself.
 */
describe('LanceDbVectorStore', () => {
  let dbDir: string;

  // Two-dimensional vectors: easy to reason about by hand.
  // Query [1, 0]: cosine similarity is 1.0 for [2,0], 0.8 for [4,3], 0 for [0,5].
  const ROWS = [
    { id: 'reports/a.md#0', vector: [2, 0], content: 'A', source: 'reports/a.md', chunkIndex: 0, title: 'A', documentType: 'reports', contentHash: 'h1' },
    { id: 'emails/b.md#0', vector: [4, 3], content: 'B', source: 'emails/b.md', chunkIndex: 0, title: 'B', documentType: 'emails', contentHash: 'h2' },
    { id: 'emails/b.md#1', vector: [0, 5], content: 'C', source: 'emails/b.md', chunkIndex: 1, title: 'B', documentType: 'emails', contentHash: 'h2' }
  ];

  beforeAll(async () => {
    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lancedb-test-'));
    const db = await lancedb.connect(dbDir);
    await db.createTable('chunks', ROWS);
  });

  afterAll(async () => {
    await fs.rm(dbDir, { recursive: true, force: true });
  });

  it('reports whether the table exists', async () => {
    expect(await LanceDbVectorStore.exists(dbDir)).toBe(true);
    expect(await LanceDbVectorStore.exists(path.join(dbDir, 'nope'))).toBe(false);
  });

  it('ranks by cosine similarity, best first', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    const results = await store.search([1, 0], { topK: 10, minScore: -1 });

    expect(results.map((r) => r.id)).toEqual(['reports/a.md#0', 'emails/b.md#0', 'emails/b.md#1']);
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[1].score).toBeCloseTo(0.8, 5);
  });

  it('drops results below minScore', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    const results = await store.search([1, 0], { topK: 10, minScore: 0.9 });

    expect(results.map((r) => r.id)).toEqual(['reports/a.md#0']);
  });

  it('caps results at topK', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    expect(await store.search([1, 0], { topK: 1, minScore: -1 })).toHaveLength(1);
  });

  it('carries the citation fields through to RetrievedChunk', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    const [top] = await store.search([1, 0], { topK: 1, minScore: -1 });

    expect(top.source).toBe('reports/a.md');
    expect(top.content).toBe('A');
    expect(top.metadata).toEqual({ title: 'A', documentType: 'reports', chunkIndex: 0 });
  });
});
```

- [ ] **Step 3: Escribir `apps/backend/src/rag/infra/lanceDbVectorStore.ts`**

```ts
import * as lancedb from '@lancedb/lancedb';
import type { VectorStorePort } from '../domain/ports.js';
import type { RetrievedChunk } from '../domain/types.js';
import { CHUNKS_TABLE } from '../../config/rag.config.js';

/**
 * One row of the `chunks` table. Deliberately FLAT - no nested objects.
 * LanceDB infers the Arrow schema from the first rows written, and a nested
 * `metadata` object would become a nested struct: harder to filter on and
 * more fragile across writes. `title`/`documentType` are stored as plain
 * columns and folded back into `RetrievedChunk.metadata` on the way out, so
 * this storage shape never leaks past this file.
 */
interface ChunkRow {
  id: string;
  vector: number[];
  content: string;
  source: string;
  chunkIndex: number;
  title: string;
  documentType: string;
  contentHash: string;
  /** Added by LanceDB on a vector query - not a stored column. */
  _distance: number;
}

/**
 * File-backed `VectorStorePort` over LanceDB. Read side only: the server
 * needs to search, not to write, and keeping the write API out of this
 * interface means an HTTP request path can't delete corpus chunks by
 * accident. Writing lives in `LanceDbVectorStoreWriter`, used by the ingest
 * CLI.
 *
 * Opened once and reused: `connect()`/`openTable()` are I/O, and the server
 * process is long-lived.
 */
export class LanceDbVectorStore implements VectorStorePort {
  private constructor(private readonly table: lancedb.Table) {}

  /** True if `dbDir` holds a table by this name - i.e. `npm run ingest` has run at least once. */
  static async exists(dbDir: string, tableName: string = CHUNKS_TABLE): Promise<boolean> {
    try {
      const db = await lancedb.connect(dbDir);
      return (await db.tableNames()).includes(tableName);
    } catch {
      // A missing/unreadable directory means "nothing ingested yet", which
      // is a normal first-run state, not an error the caller should handle.
      return false;
    }
  }

  /** Opens an existing table. Throws if it does not exist - check with `exists()` first. */
  static async open(dbDir: string, tableName: string = CHUNKS_TABLE): Promise<LanceDbVectorStore> {
    const db = await lancedb.connect(dbDir);
    return new LanceDbVectorStore(await db.openTable(tableName));
  }

  async search(
    embedding: number[],
    options: { topK: number; minScore: number }
  ): Promise<RetrievedChunk[]> {
    // `vectorSearch()`, not `search()`: `search()` also accepts a string for
    // full-text search, so it is typed `VectorQuery | Query | AutoQuery` and
    // would need a cast before `distanceType()`. `vectorSearch()` returns a
    // `VectorQuery` directly (verified in `dist/table.d.ts` of 0.39.0).
    const rows = (await this.table
      .vectorSearch(embedding)
      // Not LanceDB's default (l2). Cosine ignores vector magnitude, which
      // is what text embeddings need, AND it makes `score` below land on the
      // same [-1, 1] similarity scale `InMemoryVectorStore` produces - so a
      // single `minScore` in `RagRetrievalConfig` means the same thing
      // whichever store is plugged in.
      .distanceType('cosine')
      .limit(options.topK)
      .toArray()) as ChunkRow[];

    return rows
      .map(toRetrievedChunk)
      .filter((chunk) => chunk.score >= options.minScore);
  }
}

/** LanceDB returns cosine DISTANCE (lower is better, range [0, 2]); `RetrievedChunk.score` is a SIMILARITY (higher is better). */
function toRetrievedChunk(row: ChunkRow): RetrievedChunk {
  return {
    id: row.id,
    content: row.content,
    score: 1 - row._distance,
    source: row.source,
    metadata: {
      title: row.title,
      documentType: row.documentType,
      chunkIndex: row.chunkIndex
    }
  };
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm run test --workspace=apps/backend -- lanceDbVectorStore`
Expected: PASS, los 5 casos.

> Si `search()` devuelve las filas en un orden distinto al esperado, revisar que `.distanceType('cosine')` esté antes de `.limit()`. Si `_distance` viene `undefined`, la versión de LanceDB cambió el nombre del campo — leer `dist/query.d.ts` antes de tocar nada.

Después, correr el comando de comparación de la Tarea 0, Step 2. Expected: `OK: sin fallas nuevas`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/rag
git commit -m "feat(rag): add LanceDB-backed vector store (read side)"
```

---

# Tarea 4: `LanceDbVectorStoreWriter` — el lado de ESCRITURA

**Files:**
- Create: parte de `apps/backend/src/rag/infra/lanceDbVectorStore.ts` (misma archivo, clase nueva)
- Test: `apps/backend/src/rag/infra/lanceDbVectorStore.test.ts` (agregar `describe`)
- Modify: `apps/backend/src/rag/domain/ports.ts`

**Interfaces:**
- Consumes: `ChunkRecord` (Tarea 3), `CHUNKS_TABLE`.
- Produces:
  - `VectorStoreWriterPort` en `rag/domain/ports.ts`
  - `class LanceDbVectorStoreWriter implements VectorStoreWriterPort` — `static open(dbDir, tableName?)`, `replaceDocumentChunks(source, records)`, `deleteDocumentChunks(source)`, `countRows()`, `listDocumentHashes()`

### Contexto

**Qué construyo:** la escritura, con la operación clave del ticket: *"borrá los chunks de este documento y poné estos otros"*.

**Por qué es su propia clase y su propio puerto:** ver la Tarea 3. El servidor no debe poder borrar.

**Decisión de diseño 1 — no hay `upsert`, hay `delete` + `add`.** Un documento que cambió puede pasar de 4 chunks a 3. Un upsert por clave de fila (`mergeInsert('id')` a secas) actualizaría los 3 primeros y dejaría **huérfano** el cuarto. `delete` por `source` + `add` no tiene ese problema.

*Corrección de la revisión del 23/09:* LanceDB 0.39 **sí** puede hacer este reemplazo en una sola operación, con `mergeInsert('id')` + `whenNotMatchedBySourceDelete({ where: "source = '...'" })` (verificado en `dist/merge.d.ts`). La tabla de abajo lo pone en su lugar: es una alternativa válida, pero para otro contexto.

**Por eso la columna `source` no es decorativa: es la clave del `delete`.** Sin ella no se puede re-ingerir nada selectivamente. Esto es literalmente el punto 3 del ticket ("safe re-ingestion").

| Estrategia de update | Cuándo conviene | Cuándo no |
|---|---|---|
| **`delete(source=...)` + `add(...)`** (elegida) | Cuando la cantidad de chunks de un documento puede cambiar. Simple de razonar y de testear. | No es atómico: si el proceso muere entre el delete y el add, ese documento queda sin chunks. Se cura solo: como el estado de la ingesta es la propia tabla (Tarea 6), un documento sin filas se ve como nuevo en la corrida siguiente y se vuelve a ingerir. |
| **`mergeInsert('id')` + `whenMatchedUpdateAll()` + `whenNotMatchedInsertAll()` + `whenNotMatchedBySourceDelete({ where: source = ... })`** | Cuando **alguien lee mientras el ingest escribe**. Reemplaza los chunks de un documento en una sola operación **atómica** (todo o nada, como una transferencia bancaria), así que no hay un instante en que el documento "desaparece" entre el delete y el add. | Acá el ingest corre en `setup`, antes de que arranque el servidor: nadie lee a la mitad. Son cuatro métodos encadenados más para explicar y testear, para un beneficio que este flujo no usa. Si algún día el ingest corre con el servidor prendido, es la opción correcta. |
| **`mergeInsert('id')` a secas** | Cuando las filas tienen identidad estable y la cantidad no cambia. | **Acá es una trampa**: si el documento pasa de 4 a 3 chunks, `reports/x.md#3` sobrevive con contenido viejo y se puede citar. |
| **Borrar y recrear la tabla entera** | Corpus chico y ingest siempre completo — esto es lo que hace el Lab 4. | **Es exactamente lo que el ticket prohíbe.** |

**Decisión de diseño 2 — el `delete` usa un predicado SQL con la ruta interpolada.** `` table.delete(`source = '${source}'`) ``. Una ruta con comilla simple rompería la query. El corpus no tiene ninguna, pero el helper escapa igual: es una línea y evita una clase entera de bug.

**Decisión de diseño 3 — `open()` crea la tabla si no existe, a partir de las primeras filas.** LanceDB infiere el esquema (incluida la dimensión del vector) de lo que se escribe. La alternativa, `createEmptyTable(name, schema)` con un esquema Arrow explícito, es más estricta — te avisa si intentás escribir 512 números en una tabla de 768 — pero obliga a construir un `Schema` de `apache-arrow` a mano. Para este tamaño de proyecto, la inferencia alcanza, **y** la Tarea 7 chequea la dimensión antes de escribir, que es el mismo control donde importa.

### Bloques (~50 líneas cada uno)

- **Bloque A** — `VectorStoreWriterPort` + los tests (Steps 1–2)
- **Bloque B** — `open` / `replaceDocumentChunks` (Step 3, primera mitad)
- **Bloque C** — `deleteDocumentChunks` / `countRows` / `listDocumentHashes` / `sourceFilter` / `toRow` (Step 3, segunda mitad)

---

- [ ] **Step 1: Agregar `VectorStoreWriterPort` a `rag/domain/ports.ts`**

```ts
import type { ChunkRecord, RetrievedChunk } from './types.js';

// ... EmbeddingPort y VectorStorePort quedan como están ...

/**
 * The write side of the vector store, kept apart from `VectorStorePort` so
 * the query path (server, graph) cannot delete corpus data - only the
 * ingest CLI depends on this interface.
 *
 * There is no `upsert`: `replaceDocumentChunks` deletes by `source` and
 * re-adds, because a changed document can produce a different NUMBER of
 * chunks, and a key-based upsert would strand the extra ones.
 */
export interface VectorStoreWriterPort {
  /** Atomically-intended replace: drops every chunk whose `source` matches, then writes `records`. Passing an empty `records` is just a delete. */
  replaceDocumentChunks(source: string, records: ChunkRecord[]): Promise<void>;
  /** Drops every chunk of a document - used for files removed from the corpus. */
  deleteDocumentChunks(source: string): Promise<void>;
  countRows(): Promise<number>;
  /**
   * `source` -> `contentHash` of every document currently in the table. This
   * IS the ingest state: a document counts as ingested exactly when its rows
   * are here with a matching hash, so there is no second record that could
   * disagree with the data. `''` marks a document whose rows carry different
   * hashes (should never happen) - it matches nothing, so it gets re-embedded.
   */
  listDocumentHashes(): Promise<Map<string, string>>;
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Agregar al final de `lanceDbVectorStore.test.ts`:

```ts
describe('LanceDbVectorStoreWriter', () => {
  function record(source: string, index: number, hash: string): ChunkRecord {
    return {
      id: `${source}#${index}`,
      content: `content ${index}`,
      embedding: [index, 1],
      source,
      chunkIndex: index,
      title: source,
      documentType: 'reports',
      contentHash: hash
    };
  }

  async function freshWriter() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lancedb-writer-'));
    return { dir, writer: await LanceDbVectorStoreWriter.open(dir) };
  }

  it('reports no documents before anything was written', async () => {
    const { writer } = await freshWriter();

    expect((await writer.listDocumentHashes()).size).toBe(0);
  });

  it('creates the table on the first write', async () => {
    const { writer } = await freshWriter();

    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1')]);

    expect(await writer.countRows()).toBe(1);
  });

  it('replaces only the given document, leaving the others untouched', async () => {
    const { writer } = await freshWriter();
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1'), record('reports/a.md', 1, 'h1')]);
    await writer.replaceDocumentChunks('emails/b.md', [record('emails/b.md', 0, 'h2')]);

    // a.md changed and now produces a single chunk instead of two.
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1-v2')]);

    expect(await writer.countRows()).toBe(2);
    // One entry per document, and a.md now carries its NEW hash.
    expect(await writer.listDocumentHashes()).toEqual(new Map([['reports/a.md', 'h1-v2'], ['emails/b.md', 'h2']]));
  });

  it('deletes every chunk of a document', async () => {
    const { writer } = await freshWriter();
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1')]);
    await writer.replaceDocumentChunks('emails/b.md', [record('emails/b.md', 0, 'h2')]);

    await writer.deleteDocumentChunks('reports/a.md');

    expect([...(await writer.listDocumentHashes()).keys()]).toEqual(['emails/b.md']);
  });

  it('survives reopening the same directory', async () => {
    const { dir, writer } = await freshWriter();
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1')]);

    const reopened = await LanceDbVectorStoreWriter.open(dir);

    expect(await reopened.countRows()).toBe(1);
  });
});
```

Y agregar al `import` de arriba del archivo: `import { LanceDbVectorStore, LanceDbVectorStoreWriter } from './lanceDbVectorStore.js';` y `import type { ChunkRecord } from '../domain/types.js';`

- [ ] **Step 3: Escribir la clase en `lanceDbVectorStore.ts`**

Agregar al final del archivo (y `import type { ChunkRecord } from '../domain/types.js';` arriba, junto a `RetrievedChunk`; también `import type { VectorStoreWriterPort } from '../domain/ports.js';`):

```ts
/**
 * The write side. Separate class from `LanceDbVectorStore` so the query
 * path never gets a handle that can delete.
 *
 * The table is created lazily, from the first batch of rows written:
 * LanceDB infers the Arrow schema - including the vector dimension - from
 * the data. `CorpusIngestService` checks that dimension against the
 * configured one before it ever gets here, so inference is safe.
 */
export class LanceDbVectorStoreWriter implements VectorStoreWriterPort {
  private table?: lancedb.Table;

  private constructor(
    private readonly db: lancedb.Connection,
    private readonly tableName: string
  ) {}

  static async open(dbDir: string, tableName: string = CHUNKS_TABLE): Promise<LanceDbVectorStoreWriter> {
    const db = await lancedb.connect(dbDir);
    const writer = new LanceDbVectorStoreWriter(db, tableName);
    if ((await db.tableNames()).includes(tableName)) {
      writer.table = await db.openTable(tableName);
    }
    return writer;
  }

  async replaceDocumentChunks(source: string, records: ChunkRecord[]): Promise<void> {
    const rows = records.map(toRow);

    // No table yet means nothing was ever ingested: create it from these
    // rows, so LanceDB infers the schema (vector width included) from real
    // data. There is nothing to delete in that case.
    if (!this.table) {
      if (rows.length > 0) this.table = await this.db.createTable(this.tableName, rows);
      return;
    }

    // Delete first, then add: a changed document can produce a different
    // number of chunks, so overwriting by id alone would strand the extras.
    // `delete()` returns `{ numDeletedRows, version }` (confirmed with a
    // throwaway spike, 23/09/2026) - not surfaced today, but it's there if
    // `CorpusIngestService`'s report ever needs a per-document deleted count.
    await this.table.delete(sourceFilter(source));
    if (rows.length > 0) await this.table.add(rows);
  }

  async deleteDocumentChunks(source: string): Promise<void> {
    if (!this.table) return;
    await this.table.delete(sourceFilter(source));
  }

  async countRows(): Promise<number> {
    return this.table ? this.table.countRows() : 0;
  }

  async listDocumentHashes(): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    if (!this.table) return hashes;

    // Two string columns only. LanceDB stores data column by column, so this
    // never reads the 768-float vectors. A plain `query()` has no default
    // limit (a vector search defaults to 10) - verified in `dist/query.d.ts`.
    const rows = (await this.table.query().select(['source', 'contentHash']).toArray()) as {
      source: string;
      contentHash: string;
    }[];

    for (const { source, contentHash } of rows) {
      const seen = hashes.get(source);
      hashes.set(source, seen === undefined || seen === contentHash ? contentHash : '');
    }
    return hashes;
  }
}

/** SQL predicate used by every delete/count by document. Single quotes are doubled, the SQL way to escape them, so a path containing one can't break the predicate. */
function sourceFilter(source: string): string {
  return `source = '${source.replaceAll("'", "''")}'`;
}

function toRow(record: ChunkRecord): Omit<ChunkRow, '_distance'> {
  return {
    id: record.id,
    vector: record.embedding,
    content: record.content,
    source: record.source,
    chunkIndex: record.chunkIndex,
    title: record.title,
    documentType: record.documentType,
    contentHash: record.contentHash
  };
}
```

> **Nota sobre `createTable`:** `createTable(name, rows)` crea la tabla **y** escribe esas filas en un solo paso. Por eso el camino "no hay tabla" termina con `return`: si siguiera hasta el `add`, las filas quedarían escritas dos veces.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm run test --workspace=apps/backend -- lanceDbVectorStore`
Expected: PASS, los 10 casos (5 de lectura + 5 de escritura). El test `creates the table on the first write` es el que cuida el `return` de la nota de arriba: sin él, `countRows()` daría 2.

Después, correr el comando de comparación de la Tarea 0, Step 2. Expected: `OK: sin fallas nuevas`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/rag
git commit -m "feat(rag): add LanceDB writer with per-document replace"
```

---

# Tarea 5: `corpusReader` — listar, hashear y sacar la ruta relativa

**Files:**
- Create: `apps/backend/src/rag/ingest/corpusReader.ts`
- Test: `apps/backend/src/rag/ingest/corpusReader.test.ts`

**Interfaces:**
- Consumes: `CORPUS_ROOT`, `TEXT_EXTENSIONS` (Tarea 2).
- Produces:
  - `interface CorpusDocument { source: string; content: string; contentHash: string; title: string; documentType: string }`
  - `async function readCorpus(corpusRoot: string): Promise<CorpusDocument[]>`
  - `function sha256(text: string): string`

### Contexto

**Qué construyo:** la pieza que convierte "una carpeta con archivos" en "una lista de documentos con identidad".

**Por qué:** las tres cosas que el ticket pide dependen de esto. La **ruta relativa** es lo que va en las citas. El **hash** es lo que decide si hay que re-embeber. Y filtrar binarios es lo que evita que `ragChunk` reciba un JPEG.

**Decisión de diseño 1 — el hash es SHA-256 del contenido, no `mtime` + tamaño.**

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **Hash del contenido (SHA-256)** (elegida) | Cuando la verdad es el contenido. Sobrevive a `git clone`, a copiar la carpeta, a `unzip`. 30 archivos / ~5.500 palabras se hashean en milisegundos. | Corpus gigantes: leer y hashear todo en cada arranque cuesta I/O. |
| **`mtime` + tamaño** | Corpus enormes donde hashear es caro: `stat` es casi gratis. | **Acá es la trampa que hace fallar el ticket**: Tether va a descomprimir `corpus.zip` en *su* máquina y todos los `mtime` van a ser nuevos → se re-embebe todo → el criterio de aceptación no se cumple, y no te enterás porque en tu máquina anda. |
| **Un flag `--reingest` manual** | Como escape hatch, además de lo otro. | Como único mecanismo: depende de que alguien se acuerde. |

*Hash* en una frase: una función que agarra un texto de cualquier largo y devuelve siempre la misma huella corta (64 caracteres). Cambiás una coma, cambia la huella entera. Sirve para preguntar "¿esto es lo mismo que la vez pasada?" sin guardar el texto.

**Decisión de diseño 2 — `documentType` sale de la carpeta de primer nivel.** `corpus/reports/x.md` → `'reports'`. Es la única señal de tipo que el corpus trae, y coincide con el enum `DocumentType` que ya existe en `document/domain/document.model.ts`. Guardarlo como string en minúscula (no como el enum en mayúscula) mantiene el adaptador desacoplado de ese módulo; si mañana alguien quiere el enum, mapea al leer.

**Alternativa descartada:** leer el corpus en streaming para no tener 30 archivos en memoria a la vez. Correcto para gigabytes; acá el corpus entero son ~50 KB de texto.

**Diferencia con el proyecto real:** ninguna.

### Bloques (~50 líneas cada uno)

- **Bloque A** — el test con un corpus de mentira en un temp dir (Steps 1–2)
- **Bloque B** — `listTextFiles` recursivo + `sha256` (Step 3, primera mitad)
- **Bloque C** — `readCorpus` + el derivado de `title`/`documentType` (Step 3, segunda mitad)

---

- [ ] **Step 1: Escribir el test que falla**

Create `apps/backend/src/rag/ingest/corpusReader.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCorpus, sha256 } from './corpusReader.js';

describe('readCorpus', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-'));
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.mkdir(path.join(root, 'pictures'), { recursive: true });
    await fs.writeFile(path.join(root, 'reports', 'q1.md'), '# Q1\n\nRevenue grew.');
    await fs.writeFile(path.join(root, 'reports', 'prices.csv'), 'sku,price\nA,1');
    await fs.writeFile(path.join(root, 'pictures', 'pic.png'), Buffer.from([0x89, 0x50]));
    await fs.writeFile(path.join(root, 'notes.txt'), 'top level note');
    // What unzipping the official corpus.zip leaves behind: macOS metadata with a text extension.
    await fs.mkdir(path.join(root, '__MACOSX', 'reports'), { recursive: true });
    await fs.writeFile(path.join(root, '__MACOSX', 'reports', '._q1.md'), Buffer.from([0x00, 0x05, 0x16, 0x07]));
    await fs.writeFile(path.join(root, 'reports', '._q1.md'), Buffer.from([0x00, 0x05, 0x16, 0x07]));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('walks subdirectories and skips non-text files, hidden files and __MACOSX/', async () => {
    const documents = await readCorpus(root);

    expect(documents.map((d) => d.source).sort()).toEqual([
      'notes.txt',
      'reports/prices.csv',
      'reports/q1.md'
    ]);
  });

  it('stores paths relative to the corpus root, with forward slashes', async () => {
    const documents = await readCorpus(root);
    const report = documents.find((d) => d.source.endsWith('q1.md'));

    expect(report?.source).toBe('reports/q1.md');
    expect(report?.source.startsWith('/')).toBe(false);
  });

  it('derives title from the filename and documentType from the top-level folder', async () => {
    const documents = await readCorpus(root);

    expect(documents.find((d) => d.source === 'reports/q1.md')).toMatchObject({
      title: 'q1',
      documentType: 'reports'
    });
    // A file sitting at the corpus root has no folder to take a type from.
    expect(documents.find((d) => d.source === 'notes.txt')?.documentType).toBe('');
  });

  it('hashes the content, and the hash changes when the content changes', async () => {
    const before = (await readCorpus(root)).find((d) => d.source === 'notes.txt');
    await fs.writeFile(path.join(root, 'notes.txt'), 'top level note EDITED');
    const after = (await readCorpus(root)).find((d) => d.source === 'notes.txt');

    expect(before?.contentHash).toHaveLength(64);
    expect(after?.contentHash).not.toBe(before?.contentHash);
  });
});

describe('sha256', () => {
  it('is deterministic and sensitive to a single character', () => {
    expect(sha256('hola')).toBe(sha256('hola'));
    expect(sha256('hola')).not.toBe(sha256('holA'));
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npm run test --workspace=apps/backend -- corpusReader`
Expected: FAIL — `Failed to resolve import "./corpusReader.js"`.

- [ ] **Step 3: Escribir `apps/backend/src/rag/ingest/corpusReader.ts`**

```ts
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TEXT_EXTENSIONS } from '../../config/rag.config.js';

/** One corpus file, with everything the ingest needs to decide what to do with it. */
export interface CorpusDocument {
  /**
   * Path relative to the corpus root, forward-slashed - e.g.
   * "reports/q1-2026-sales-summary.md". This exact string is what ends up
   * in a citation and what the vector store deletes by, so it is derived
   * here, once, and never re-derived downstream.
   */
  source: string;
  content: string;
  /** SHA-256 hex of `content`. The only signal the ingest uses to decide whether a document changed. */
  contentHash: string;
  /** Filename without its extension. */
  title: string;
  /** Top-level corpus folder ('reports', 'emails', ...), or '' for a file sitting at the root. */
  documentType: string;
}

/**
 * SHA-256 of a string, hex-encoded. Content-based rather than filesystem-
 * based on purpose: `mtime` is rewritten by `unzip`, `git clone` and plain
 * copying, so a corpus that is byte-identical on the evaluator's machine
 * would look entirely new and be re-embedded from scratch - exactly what
 * the acceptance criteria forbid.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Recursively lists every text file under `dir`, skipping binaries (`ragChunk()` does not process them).
 * Also skips hidden entries and `__MACOSX/`: the official `corpus.zip` ships 39 macOS
 * metadata files like `__MACOSX/emails/._007-sla-reminder.md` - binary, but with a
 * `.md` extension, so an extension check alone would ingest (and later cite) them.
 */
async function listTextFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTextFiles(entryPath)));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
}

/** Reads and hashes every text document under `corpusRoot`. */
export async function readCorpus(corpusRoot: string): Promise<CorpusDocument[]> {
  const absolutePaths = await listTextFiles(corpusRoot);

  return Promise.all(
    absolutePaths.map(async (absolutePath) => {
      const content = await fs.readFile(absolutePath, 'utf8');
      // `path.relative` yields backslashes on Windows; citations must be
      // stable across platforms, so they are normalised to forward slashes.
      const source = path.relative(corpusRoot, absolutePath).split(path.sep).join('/');
      const [head, ...rest] = source.split('/');

      return {
        source,
        content,
        contentHash: sha256(content),
        title: path.basename(source, path.extname(source)),
        documentType: rest.length > 0 ? head : ''
      };
    })
  );
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm run test --workspace=apps/backend -- corpusReader`
Expected: PASS, los 5 casos.

- [ ] **Step 5: Verificar contra el corpus real**

```bash
cd apps/backend && npx tsx -e "
import { readCorpus } from './src/rag/ingest/corpusReader.js';
import { CORPUS_ROOT } from './src/config/rag.config.js';
(async () => {
const docs = await readCorpus(CORPUS_ROOT);
console.log('documentos:', docs.length);
console.log('tipos:', [...new Set(docs.map(d => d.documentType))].sort().join(', '));
console.log('ejemplo:', docs[0].source, '|', docs[0].contentHash.slice(0, 12));
})();
"
```

> **Corregido el 23/09/2026 al ejecutarlo:** la versión original tenía el `await` suelto y fallaba con `Top-level await is currently not supported with the "cjs" output format` — `tsx -e` compila a CommonJS. Envolverlo en una función `async` lo resuelve.

Expected: `documentos: 30` y los tipos `data, emails, faqs, policies, reports, transcripts`. **Ninguna ruta debe empezar con `corpus/` ni con `/`.**

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/rag/ingest
git commit -m "feat(rag): read and hash the corpus with root-relative paths"
```

---

# Tarea 6: eliminada — el estado de la ingesta vive en la propia tabla

> **Revisión del 23/09/2026.** Esta tarea escribía `ingestState.ts`: un `ingest-state.json` al lado de la base, con `{ "reports/q1.md": "a3f8..." }`. Se eliminó. **No hay código en esta tarea**; se deja el número para no renumerar las referencias de las Tareas 7, 8 y 9 ni el Definition of Done.

### Qué cambió y por qué

La versión anterior guardaba el hash de cada documento **en dos lugares**: en el JSON y en la columna `contentHash` de cada fila de la tabla (Tarea 3). La justificación era que el JSON servía para decidir rápido y la columna para reconstruir el JSON si se perdía. Pero:

1. **Dos memorias del mismo dato se pueden contradecir.** El JSON puede decir "ingerido" y la tabla no tener las filas, o al revés. Cada caso pedía su propio cuidado: escribir el JSON al final, escribirlo con `rename` para que sea atómico, decidir qué pasa si está corrupto. Toda esa lógica existía solo para mantener sincronizadas dos copias.
2. **La reconstrucción nunca se escribió.** `listSources()` (Tarea 4) estaba "para reconstruir el estado si se pierde", pero ningún código la llamaba. Era una red de seguridad sin nada que la usara.
3. **El costo que la descartaba no existe con esta base.** La tabla de trade-offs decía *"hay que leer y agrupar la tabla entera"*. LanceDB guarda los datos **por columna** (formato *columnar*: cada columna está en su propio bloque del archivo, como una planilla guardada columna por columna en vez de fila por fila). Leer `source` + `contentHash` **no toca los vectores**, que son el 99% del peso. Con 100 filas es instantáneo; con un millón son dos columnas de texto, no un millón de vectores.

**Ahora:** `VectorStoreWriterPort.listDocumentHashes()` (Tarea 4) devuelve `source → contentHash` leyendo esas dos columnas, y `CorpusIngestService` (Tarea 7) decide con eso. La tabla **es** el estado.

### Lo que se gana en robustez: el corte a la mitad se cura solo

`replaceDocumentChunks` hace `delete` y después `add`: dos escrituras. Si el proceso muere entre las dos, ese documento queda **sin filas**.

- **Con el JSON:** había que razonar en qué orden se escribía cada cosa para no terminar con un JSON que dijera "ingerido" sobre un documento sin filas.
- **Con la tabla como estado:** un documento sin filas simplemente **no aparece** en `listDocumentHashes()`, así que la corrida siguiente lo ve como nuevo y lo vuelve a ingerir. No hay orden que respetar ni archivo que se pueda corromper. Y lo que ya se terminó antes del corte **no se pierde**: cada `add` de LanceDB es una escritura completa (queda como una versión nueva en `_versions/`).

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **Derivarlo de la tabla** (elegida) | Cuando la base guarda por columna y la huella (hash) ya viaja en cada fila. Una sola fuente de verdad: el estado no puede contradecir a los datos. | Si la base fuera por filas (leer el hash obligaría a leer los vectores), o si el estado tuviera que describir cosas que no dejan filas. Ejemplo: "este documento se procesó y dio 0 fragmentos" (ver abajo). |
| **Un JSON al lado de la base** (la versión anterior) | Cuando el estado se quiere leer y editar a mano, o cuando la base no permite leer columnas sueltas barato. | Acá: suma un archivo que hay que mantener sincronizado a mano, y la lógica de escritura atómica y de archivo corrupto existe solo por esa sincronización. |
| **Una segunda tabla LanceDB** | Si el estado creciera con campos que no son de ningún fragmento (fecha de la última corrida, versión de configuración). | LanceDB está hecha para vectores; una tabla de metadatos sin vector es forzar la herramienta. |

### Lo que se pierde, y cómo se cubre

- **Ya no se puede mirar el estado "a ojo" con `cat`.** Se cubre con el reporte del CLI (Tarea 8), que lista qué documento se agregó, se actualizó, se borró o quedó igual. También con el chequeo 5/6 del DoD, que imprime las rutas guardadas en la tabla.
- **Un documento vacío (0 fragmentos) no deja filas**, así que cada corrida lo vuelve a leer y a partir, y sale como `added` en el reporte. **Nunca se embebe:** con 0 fragmentos no hay nada que mandar al modelo, así que el criterio de aceptación se cumple igual. El corpus de hoy no tiene documentos vacíos. Anotado como límite conocido en el README (Tarea 9).
- **Forzar un re-ingest completo** sigue siendo lo mismo: `rm -rf .lancedb`.

**Diferencia con el proyecto real:** ninguna. Si más adelante se agrega la huella de configuración (modelo de embeddings + `CHUNK_OPTIONS`, hoy fuera de alcance), el lugar natural es una columna más en cada fila, por la misma razón: que el dato que decide viva junto a los datos que describe.

---

# Tarea 7: `CorpusIngestService` — el diff (el corazón del ticket)

**Files:**
- Create: `apps/backend/src/rag/ingest/corpusIngest.service.ts`
- Test: `apps/backend/src/rag/ingest/corpusIngest.service.test.ts`
- Create: `apps/backend/src/rag/infra/qvacChunker.adapter.ts`
- Modify: `apps/backend/src/rag/domain/ports.ts`

**Interfaces:**
- Consumes: `EmbeddingPort.embedBatch` (T2), `VectorStoreWriterPort` (T4), `VectorStoreWriterPort.listDocumentHashes` (T4, es el estado de la ingesta: ver Tarea 6), `readCorpus`/`CorpusDocument` (T5), `EMBEDDING_DIMENSIONS`/`CHUNK_OPTIONS` (T2).
- Produces:
  - `ChunkerPort { chunk(document: string): Promise<string[]> }` en `rag/domain/ports.ts`
  - `class QvacChunker implements ChunkerPort`
  - `interface IngestReport { added: string[]; updated: string[]; unchanged: string[]; removed: string[]; chunksWritten: number }`
  - `interface CorpusIngestOptions { dimensions?: number }`
  - `class CorpusIngestService` — constructor `(chunker, embeddingPort, writer, options?: CorpusIngestOptions)`; método `ingest(corpusRoot: string): Promise<IngestReport>`

### Contexto

**Qué construyo:** el algoritmo entero del ticket, en una clase, sin tocar disco de QVAC ni LanceDB directamente — todo por puertos, así se testea con dobles y sin cargar un modelo.

**Por qué:** los puntos 2 y 3 del ticket viven acá. El Lab 4 **no** cubre esto: borra la tabla y la rehace.

El algoritmo:

```
ingest(corpusRoot):
  ingerido   = writer.listDocumentHashes()           ← la tabla ES el estado (source → hash)
  documentos = readCorpus(corpusRoot)

  por cada documento:
      si ingerido[source] === contentHash  →  "sin cambios", saltear   ← el criterio de aceptación
      si ingerido[source] existe            →  "cambió"    (replace)
      si no                                 →  "nuevo"     (add)

      textos   = chunker.chunk(documento.content)
      vectores = embeddingPort.embedBatch(textos)       ← un solo viaje RPC
      writer.replaceDocumentChunks(source, filas)       ← esto mismo "anota" el nuevo estado

  huérfanos = documentos de la tabla que ya no están en disco
  por cada huérfano: writer.deleteDocumentChunks(source)
```

**Decisión de diseño 1 — no hay un paso "guardar el estado".** El estado es la tabla (ver Tarea 6), así que cada `replaceDocumentChunks` deja anotado, en la misma escritura, que ese documento quedó ingerido. Si el proceso muere a mitad, lo que ya terminó queda terminado (no se re-embebe), y un documento que quedó entre el `delete` y el `add` no tiene filas: la corrida siguiente lo ve como nuevo. Nunca puede quedar un documento marcado como ingerido que en realidad no está, porque "marcado" y "está" son la misma cosa.

**Alternativa descartada (la versión anterior de este plan):** un `ingest-state.json` escrito una vez al final. Si el proceso moría a mitad, se perdía el registro de todo lo hecho en esa corrida, y había que razonar el orden de las escrituras para no desincronizar el JSON de la tabla. Tendría sentido si la base no permitiera leer dos columnas sin leer los vectores.

**Decisión de diseño 2 — la dimensión se verifica contra el primer vector real.** Si alguien cambia el modelo de embeddings y la tabla ya existe con 768 columnas, escribir 512 números rompería la tabla o fallaría con un error de Arrow ilegible. El chequeo explícito convierte eso en un mensaje que se entiende.

**Decisión de diseño 3 — los huérfanos salen de la misma lectura.** Los documentos que están en `listDocumentHashes()` y no en disco son los que se borraron del corpus. No hace falta una segunda consulta: es la misma lista que ya se leyó al principio.

**Decisión de diseño 4 — `ChunkerPort` existe solo para poder testear.** Sin él, testear el diff requeriría un worker de QVAC vivo. Con él, el test usa un chunker que parte por líneas y corre en milisegundos.

**Diferencia con el proyecto real:** ninguna.

### Bloques (~50 líneas cada uno)

- **Bloque A** — `ChunkerPort` + `QvacChunker` (Steps 1–2)
- **Bloque B** — los tests con dobles (Step 3)
- **Bloque C** — `IngestReport` + el esqueleto de `ingest()` (Step 5, primera mitad)
- **Bloque D** — el bucle por documento + huérfanos (Step 5, segunda mitad)

---

- [ ] **Step 1: Agregar `ChunkerPort` a `rag/domain/ports.ts`**

```ts
/**
 * Splits a whole document into chunk texts, in document order. Behind a
 * port because the real implementation is an RPC into the QVAC worker: this
 * lets `CorpusIngestService` be tested with a trivial splitter, with no
 * worker and no model.
 */
export interface ChunkerPort {
  chunk(document: string): Promise<string[]>;
}
```

- [ ] **Step 2: Escribir `apps/backend/src/rag/infra/qvacChunker.adapter.ts`**

```ts
import { ragChunk } from '@qvac/sdk';
import type { ChunkerPort } from '../domain/ports.js';
import { CHUNK_OPTIONS } from '../../config/rag.config.js';

/**
 * Real `ChunkerPort`, backed by the SDK's `ragChunk()` primitive - one of
 * the two primitives the challenge requires this store to be populated
 * through (the other is `embed()`). `ragIngest()`/`ragSearch()` are
 * explicitly excluded by the challenge and are not used anywhere.
 *
 * This is the one file outside `models/infra` that imports `@qvac/sdk`, on
 * purpose: `ragChunk()` takes no `modelId`, loads nothing and owns no
 * connection lifecycle (verified against `dist/client/api/rag.d.ts`), so it
 * is a text primitive rather than a model operation, and routing it through
 * `ModelRuntimePort` would put a non-model concern in a model-runtime port.
 * `close()` is still owned solely by `ModelManagementService`.
 */
export class QvacChunker implements ChunkerPort {
  async chunk(document: string): Promise<string[]> {
    // `ragChunk()` always returns `Array<{ id, content }>` - never bare
    // strings, never `{ chunks: [...] }`. Verified against the installed
    // package before writing this (a wrong guess here cost a bug in Lab 4).
    const chunks = await ragChunk({ documents: document, chunkOpts: CHUNK_OPTIONS });
    return chunks.map((chunk) => chunk.content);
  }
}
```

- [ ] **Step 3: Escribir el test que falla**

Create `apps/backend/src/rag/ingest/corpusIngest.service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CorpusIngestService } from './corpusIngest.service.js';
import type { ChunkerPort, EmbeddingPort, VectorStoreWriterPort } from '../domain/ports.js';
import type { ChunkRecord } from '../domain/types.js';

/** Splits on blank lines. No worker, no model - the diff logic is what's under test. */
const chunker: ChunkerPort = {
  chunk: async (document) => document.split('\n\n').filter((part) => part.trim().length > 0)
};

function makeEmbedding(): EmbeddingPort & { calls: number } {
  const port = {
    calls: 0,
    embed: async (text: string) => [text.length, 0, 0],
    embedBatch: async (texts: string[]) => {
      port.calls += texts.length;
      return texts.map((text) => [text.length, 0, 0]);
    }
  };
  return port;
}

/**
 * In-memory stand-in for the LanceDB table. It is ALSO the ingest state
 * (`listDocumentHashes` reads it back), so a test about "the second run"
 * reuses the same writer - the same way the real table survives on disk
 * between two processes.
 */
function makeWriter(): VectorStoreWriterPort & { rows: Map<string, ChunkRecord[]> } {
  const rows = new Map<string, ChunkRecord[]>();
  return {
    rows,
    replaceDocumentChunks: vi.fn(async (source: string, records: ChunkRecord[]) => {
      if (records.length > 0) rows.set(source, records);
      else rows.delete(source);
    }),
    deleteDocumentChunks: vi.fn(async (source: string) => {
      rows.delete(source);
    }),
    countRows: async () => [...rows.values()].reduce((sum, list) => sum + list.length, 0),
    listDocumentHashes: async () => new Map([...rows].map(([source, records]) => [source, records[0].contentHash]))
  };
}

describe('CorpusIngestService', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-'));
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.writeFile(path.join(root, 'reports', 'a.md'), 'para uno\n\npara dos');
    await fs.writeFile(path.join(root, 'reports', 'b.md'), 'solo una');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function service(embedding: EmbeddingPort, writer: VectorStoreWriterPort) {
    return new CorpusIngestService(chunker, embedding, writer, { dimensions: 3 });
  }

  it('embeds everything on the first run', async () => {
    const embedding = makeEmbedding();
    const writer = makeWriter();

    const report = await service(embedding, writer).ingest(root);

    expect(report.added.sort()).toEqual(['reports/a.md', 'reports/b.md']);
    expect(report.unchanged).toEqual([]);
    expect(report.chunksWritten).toBe(3);
    expect(embedding.calls).toBe(3);
  });

  it('re-embeds nothing on a second run with an unchanged corpus', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    vi.clearAllMocks(); // forget the first run's calls, keep its rows

    const embedding = makeEmbedding();
    const report = await service(embedding, writer).ingest(root);

    expect(report.unchanged.sort()).toEqual(['reports/a.md', 'reports/b.md']);
    expect(report.added).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(embedding.calls).toBe(0);
    expect(writer.replaceDocumentChunks).not.toHaveBeenCalled();
  });

  it('re-embeds only the document that changed', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    await fs.writeFile(path.join(root, 'reports', 'a.md'), 'para uno EDITADO\n\npara dos');
    vi.clearAllMocks();

    const report = await service(makeEmbedding(), writer).ingest(root);

    expect(report.updated).toEqual(['reports/a.md']);
    expect(report.unchanged).toEqual(['reports/b.md']);
    expect(writer.replaceDocumentChunks).toHaveBeenCalledTimes(1);
  });

  it('drops the chunks of a document removed from the corpus', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    await fs.rm(path.join(root, 'reports', 'b.md'));

    const report = await service(makeEmbedding(), writer).ingest(root);

    expect(report.removed).toEqual(['reports/b.md']);
    expect(writer.deleteDocumentChunks).toHaveBeenCalledWith('reports/b.md');
    expect([...writer.rows.keys()]).toEqual(['reports/a.md']);
  });

  it('re-ingests a document left without rows by a run that died between delete and add', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    // Exactly what that crash leaves behind: the document has no rows at all.
    writer.rows.delete('reports/a.md');

    const embedding = makeEmbedding();
    const report = await service(embedding, writer).ingest(root);

    expect(report.added).toEqual(['reports/a.md']);
    expect(report.unchanged).toEqual(['reports/b.md']);
    expect(embedding.calls).toBe(2);
  });

  it('writes citation-ready records: root-relative source, stable id, document hash', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);

    const records = writer.rows.get('reports/a.md');
    expect(records?.map((r) => r.id)).toEqual(['reports/a.md#0', 'reports/a.md#1']);
    expect(records?.[0].source).toBe('reports/a.md');
    expect(records?.[0].documentType).toBe('reports');
    expect(records?.[0].title).toBe('a');
    // Every chunk of a document carries the SAME document-level hash.
    expect(records?.[0].contentHash).toBe(records?.[1].contentHash);
  });

  it('fails loudly when the embedding dimension does not match the configured one', async () => {
    const wrongSize: EmbeddingPort = {
      embed: async () => [1, 2],
      embedBatch: async (texts) => texts.map(() => [1, 2])
    };

    await expect(service(wrongSize, makeWriter()).ingest(root)).rejects.toThrow(/dimension/i);
  });
});
```

- [ ] **Step 4: Correr y confirmar que falla**

Run: `npm run test --workspace=apps/backend -- corpusIngest`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 5: Escribir `apps/backend/src/rag/ingest/corpusIngest.service.ts`**

```ts
import type { ChunkerPort, EmbeddingPort, VectorStoreWriterPort } from '../domain/ports.js';
import type { ChunkRecord } from '../domain/types.js';
import { EMBEDDING_DIMENSIONS } from '../../config/rag.config.js';
import { readCorpus, type CorpusDocument } from './corpusReader.js';

/** What one ingest run did, per document. Printed by the CLI and asserted by tests. */
export interface IngestReport {
  /** Documents with no rows in the table yet: first run, a new file, or one a crashed run left empty. */
  added: string[];
  /** Documents whose content hash changed since they were ingested - their old chunks were replaced. */
  updated: string[];
  /** Documents skipped entirely: not read past the hash, not chunked, not embedded. */
  unchanged: string[];
  /** Documents in the table that no longer exist on disk - their chunks were deleted. */
  removed: string[];
  chunksWritten: number;
}

export interface CorpusIngestOptions {
  /** Expected embedding width. Injectable so tests can use tiny vectors. */
  dimensions?: number;
}

/**
 * Incremental corpus ingestion: read -> diff by content hash -> chunk ->
 * embed -> write. The whole point is the diff: a document whose SHA-256 is
 * unchanged is never chunked and never embedded, which is what
 * "already-ingested unchanged documents are not unnecessarily re-embedded"
 * means in practice.
 *
 * There is no separate state file: the table itself says what was ingested
 * (`listDocumentHashes()`), so the state can never disagree with the data.
 * Each document is committed by its own write - a run that dies halfway keeps
 * everything it finished, and a document caught between delete and add just
 * has no rows, so the next run sees it as new.
 *
 * Depends only on ports, so it runs in tests with a line-splitting chunker
 * and a fake embedder - no QVAC worker, no model download, no LanceDB.
 */
export class CorpusIngestService {
  private readonly dimensions: number;

  constructor(
    private readonly chunker: ChunkerPort,
    private readonly embeddingPort: EmbeddingPort,
    private readonly writer: VectorStoreWriterPort,
    options: CorpusIngestOptions = {}
  ) {
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  }

  async ingest(corpusRoot: string): Promise<IngestReport> {
    const ingested = await this.writer.listDocumentHashes();
    const documents = await readCorpus(corpusRoot);
    const onDisk = new Set(documents.map((document) => document.source));
    const report: IngestReport = { added: [], updated: [], unchanged: [], removed: [], chunksWritten: 0 };

    for (const document of documents) {
      const ingestedHash = ingested.get(document.source);
      if (ingestedHash === document.contentHash) {
        report.unchanged.push(document.source);
        continue;
      }

      const records = await this.buildRecords(document);
      await this.writer.replaceDocumentChunks(document.source, records);

      (ingestedHash === undefined ? report.added : report.updated).push(document.source);
      report.chunksWritten += records.length;
    }

    // In the table but no longer on disk. Its chunks would otherwise stay
    // searchable forever and be cited from a document that does not exist.
    for (const source of ingested.keys()) {
      if (onDisk.has(source)) continue;
      await this.writer.deleteDocumentChunks(source);
      report.removed.push(source);
    }

    return report;
  }

  /** Chunks and embeds one document, in a single embedding round trip. */
  private async buildRecords(document: CorpusDocument): Promise<ChunkRecord[]> {
    const texts = await this.chunker.chunk(document.content);
    if (texts.length === 0) return [];

    const vectors = await this.embeddingPort.embedBatch(texts);

    if (vectors[0].length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: model returned ${vectors[0].length}, store expects ${this.dimensions}. ` +
          `Update EMBEDDING_DIMENSIONS in config/rag.config.ts and delete the vector DB directory to rebuild it.`
      );
    }

    return texts.map((content, index) => ({
      id: `${document.source}#${index}`,
      content,
      embedding: vectors[index],
      source: document.source,
      chunkIndex: index,
      title: document.title,
      documentType: document.documentType,
      contentHash: document.contentHash
    }));
  }
}
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npm run test --workspace=apps/backend -- corpusIngest`
Expected: PASS, los 7 casos. El segundo (`re-embeds nothing on a second run`) **es el criterio de aceptación del ticket, en un test**. El quinto (`re-ingests a document left without rows...`) es la prueba de que el estado derivado de la tabla se cura solo después de un corte.

- [ ] **Step 7: Comparar contra la línea de base (toda la suite + tipos)**

Correr el comando de comparación de la Tarea 0, Step 2.
Expected: `OK: sin fallas nuevas`. Los 3 archivos que ya fallaban en `main` siguen fallando igual: no son de este ticket.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/rag
git commit -m "feat(rag): add incremental corpus ingestion with hash-based change detection"
```

---

# Tarea 8: `npm run ingest` — el CLI, y los 6 checks del Definition of Done

**Files:**
- Create: `apps/backend/src/rag/ingest/ingest.cli.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el comando `npm run ingest --workspace=apps/backend`. Sale con código 0 en éxito, 1 en error.

### Contexto

**Qué construyo:** el pegamento. Arma las piezas reales (worker de QVAC, modelo de embeddings, LanceDB en disco), corre el ingest, imprime el reporte y cierra prolijo.

**Por qué un CLI y no el arranque del servidor:** decidido explícitamente. Separa lo caro (cargar un modelo de 277 MB y embeber 100 chunks) de lo barato (levantar Express). Y hace que el criterio de aceptación sea **demostrable**: se corre dos veces y la segunda dice `0 re-embedded`.

**Decisión de diseño — el `finally` cierra siempre, y el error se re-lanza después.** Si el ingest explota y no se llama `close()`, el worker de QVAC queda vivo y **Node no termina**: la terminal se queda colgada. El patrón es el mismo que ya usa `ragDemo.ts`: guardar el error, limpiar, re-lanzar.

**La pausa de 150 ms entre `unloadModel` y `close`** es una regla del proyecto, verificada: sin ella el descargado puede pisarse con el cierre de la conexión.

**Alternativa descartada — flags de CLI (`--reingest`, `--corpus=...`).** Útiles cuando el comando lo corre gente distinta con corpus distintos. Acá hay un corpus y una ruta. Forzar un re-ingest completo ya tiene una forma obvia: `rm -rf .lancedb`. Agregar un parser de argumentos ahora es complejidad sin caso de uso.

### Bloques

- **Bloque A** — `main()`: armado de dependencias + ingest (Step 1, primera mitad)
- **Bloque B** — impresión del reporte + cierre (Step 1, segunda mitad)

---

- [ ] **Step 1: Escribir `apps/backend/src/rag/ingest/ingest.cli.ts`**

```ts
import { QvacRuntimeAdapter } from '../../models/infra/qvacRuntimeAdapter.js';
import { ModelManagementService } from '../../models/service/models.service.js';
import { QvacEmbeddingAdapter } from '../infra/qvacEmbedding.adapter.js';
import { QvacChunker } from '../infra/qvacChunker.adapter.js';
import { LanceDbVectorStoreWriter } from '../infra/lanceDbVectorStore.js';
import { CorpusIngestService, type IngestReport } from './corpusIngest.service.js';
import { CORPUS_ROOT, VECTOR_DB_DIR } from '../../config/rag.config.js';

function printReport(report: IngestReport, totalRows: number): void {
  const list = (label: string, items: string[]): void => {
    console.log(`  ${label.padEnd(12)} ${items.length}`);
    for (const item of items) console.log(`      - ${item}`);
  };

  console.log('\n=== Ingest report ===');
  list('added', report.added);
  list('updated', report.updated);
  list('removed', report.removed);
  console.log(`  ${'unchanged'.padEnd(12)} ${report.unchanged.length} (not re-embedded)`);
  console.log(`\n  chunks written this run: ${report.chunksWritten}`);
  console.log(`  rows in table now:       ${totalRows}`);
  console.log(`  vector store:            ${VECTOR_DB_DIR}`);
}

async function main(): Promise<void> {
  const adapter = new QvacRuntimeAdapter();
  const modelService = new ModelManagementService(adapter, adapter);
  const embeddingPort = new QvacEmbeddingAdapter(modelService);
  const writer = await LanceDbVectorStoreWriter.open(VECTOR_DB_DIR);

  const ingestService = new CorpusIngestService(new QvacChunker(), embeddingPort, writer);

  let failure: unknown;

  try {
    console.log(`Ingesting ${CORPUS_ROOT} ...`);
    const report = await ingestService.ingest(CORPUS_ROOT);
    printReport(report, await writer.countRows());
  } catch (err) {
    failure = err;
  }

  // Always runs: leaving the QVAC worker open keeps Node alive and the
  // terminal hangs. Cleanup failures are reported but never mask the real
  // error, if there was one.
  try {
    await embeddingPort.unload();
    // Project rule, verified: give the unload a moment before tearing the
    // connection down, or the two can race.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await modelService.close();
  } catch (cleanupErr) {
    console.error('Cleanup failed:', cleanupErr);
    if (!failure) failure = cleanupErr;
  }

  if (failure) throw failure;
}

main().catch((err: unknown) => {
  console.error('\n✖ Ingest failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: DoD check 1/6 — primera corrida completa**

```bash
rm -rf .lancedb
npm run ingest --workspace=apps/backend
```

Expected: `added 30`, `unchanged 0`, `chunks written this run: ~100`, `rows in table now: ~100`. El proceso **termina solo** (no se cuelga). Además, `.qvac-cache/` en la raíz del repo tiene que contener el modelo de embeddings. Si no aparece ahí, el comando no corrió desde `apps/backend` (ver Global Constraints).

- [ ] **Step 3: DoD check 2/6 — la segunda corrida no re-embebe nada**

```bash
npm run ingest --workspace=apps/backend
```

Expected: `added 0`, `updated 0`, `unchanged 30 (not re-embedded)`, `chunks written this run: 0`, y `rows in table now` **igual que antes**.
**Este es el criterio de aceptación del ticket.** Además tiene que tardar notoriamente menos: no carga chunks ni embebe.

- [ ] **Step 4: DoD check 3/6 — tocar un archivo re-embebe solo ese**

```bash
echo "" >> corpus/reports/q1-2026-sales-summary.md
npm run ingest --workspace=apps/backend
git checkout corpus/reports/q1-2026-sales-summary.md
```

Expected: `updated 1` con ese archivo y solo ese, `unchanged 29`.

- [ ] **Step 5: DoD check 4/6 — borrar un archivo borra sus chunks**

```bash
mv corpus/emails/005-churn-alert.md /tmp/
npm run ingest --workspace=apps/backend
mv /tmp/005-churn-alert.md corpus/emails/
npm run ingest --workspace=apps/backend
```

Expected: en la primera corrida `removed 1` con `emails/005-churn-alert.md` y `rows in table now` **menor**. En la segunda vuelve como `added 1`.

- [ ] **Step 6: DoD check 5/6 — las rutas son relativas a la raíz del corpus**

```bash
cd apps/backend && npx tsx -e "
import { LanceDbVectorStoreWriter } from './src/rag/infra/lanceDbVectorStore.js';
import { VECTOR_DB_DIR } from './src/config/rag.config.js';
const writer = await LanceDbVectorStoreWriter.open(VECTOR_DB_DIR);
const sources = [...(await writer.listDocumentHashes()).keys()].sort();
console.log('documentos en la tabla:', sources.length);
console.log(sources.slice(0, 5).join('\n'));
" && cd ../..
```

Expected: `documentos en la tabla: 30` y rutas como `data/account-health-q2-close.json`. **Ninguna** empieza con `corpus/`, con `/` ni con `__MACOSX/`. Es la misma lectura que usa el ingest para decidir qué re-embeber, así que este chequeo mira el estado real y no una copia.

- [ ] **Step 7: DoD check 6/6 — persiste entre procesos y la dimensión es la del modelo**

```bash
cd apps/backend && npx tsx -e "
import { LanceDbVectorStore } from './src/rag/infra/lanceDbVectorStore.js';
import { QvacRuntimeAdapter } from './src/models/infra/qvacRuntimeAdapter.js';
import { ModelManagementService } from './src/models/service/models.service.js';
import { QvacEmbeddingAdapter } from './src/rag/infra/qvacEmbedding.adapter.js';
import { VECTOR_DB_DIR } from './src/config/rag.config.js';
const a = new QvacRuntimeAdapter();
const s = new ModelManagementService(a, a);
const e = new QvacEmbeddingAdapter(s);
const store = await LanceDbVectorStore.open(VECTOR_DB_DIR);
const q = await e.embed('what is the enterprise P1 first-response SLA?');
console.log('dimension de la consulta:', q.length);
for (const r of await store.search(q, { topK: 3, minScore: -1 })) {
  console.log(r.score.toFixed(4), '|', r.source, '|', r.content.slice(0, 70).replace(/\n/g, ' '));
}
await e.unload();
await new Promise(r => setTimeout(r, 150));
await s.close();
"
```

Expected: `dimension de la consulta: 768` y tres resultados **sin haber corrido ningún ingest en este proceso** — es decir, los embeddings sobrevivieron al reinicio. El primer resultado debería venir de `faqs/support-sla-faq.html` o `policies/escalation-matrix.txt`.

`minScore` **no** se calibra con esta sola pregunta: eso lo hace la Tarea 9 con el script de evaluación (10 preguntas del corpus + 3 fuera del corpus).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/rag/ingest
git commit -m "feat(rag): add ingest CLI"
```

---

# Tarea 9: Enchufarlo al RAG real — `ragDemo`, `server.ts`, y el "después"

**Files:**
- Modify: `apps/backend/src/ai/ragDemo.ts`
- Modify: `apps/backend/src/server.ts` (líneas 11–14 y 29–45 de `28d5335`)
- Modify: `apps/backend/src/rag/service/rag.service.const.ts`
- Modify: `apps/backend/src/rag/infra/inMemoryVectorStore.ts` (solo el comentario)
- Modify: `apps/backend/src/rag/infra/fakeEmbedding.adapter.ts` (solo el comentario)
- Modify: `apps/backend/README.md`
- Usa (fuera del repo, no se commitea): `$VERIF/retrieval-eval.ts` (Tarea 0)

**Interfaces:**
- Consumes: `QvacEmbeddingAdapter` (T2), `LanceDbVectorStore.exists/open` (T3), `VECTOR_DB_DIR` (T2), la tabla escrita por `npm run ingest` (T8).
- Produces: `npm run rag-demo` y `POST /v1/chat/completions` contestando con contexto real del corpus, recuperado de disco. `DEFAULT_RAG_CONFIG.minScore` medido.

### Contexto

**Qué construyo:** el cierre. Hasta acá el store persistente existe y se puede buscar, pero el servidor y el demo siguen usando 6 fixtures con embeddings falsos.

**Por qué entra `server.ts` (cambio respecto de la versión anterior del plan):** el ticket pide *"Integrate LanceDB as the file-backed local vector store"* y *"Embeddings survive **application** restart"*. Desde el PR #17, la aplicación (`server.ts`) usa el RAG, y el comentario del placeholder dice que reemplazarlo es este ticket. Sin este cambio, el ticket termina con un store que la app no usa.

**Qué NO entra, a propósito:** nada de `AgentService`. En particular, `preload()` sigue cargando solo el modelo de chat. El de embeddings se carga con la primera pregunta (`QvacEmbeddingAdapter` es perezoso). Esa primera respuesta tarda unos segundos más, y `/api/chat/status` dice `ready` antes de que esté cargado. Anotado como límite conocido en el README.

**Decisión de diseño 1 — el servidor NUNCA ingiere.** Solo abre la tabla y busca. Si la tabla no existe, **no arranca**, con un mensaje que dice qué correr. La alternativa sería ingerir al arrancar si falta la tabla.

| Opción | Cuándo conviene | Cuándo no |
|---|---|---|
| **No arrancar y avisar** (elegida) | Cuando el ingest y el servicio corren en fases separadas: justo lo que exige `qvac-eval.json` (`setup` con red, `start` sin red). | Un producto para usuarios finales que no saben correr un comando: ahí conviene ingerir solo. |
| **Ingerir al arrancar si falta la tabla** | Demos de un solo comando. | En `start` no hay red: si falta el modelo de embeddings, el arranque cuelga o falla a mitad, y el primer arranque tarda minutos sin decir por qué. |

**Decisión de diseño 2 — `minScore` se mide con 10 preguntas, no con una.** El valor actual (`0.65`) fue elegido para un embedder que no existe más. El script de la Tarea 0 imprime dos números: el score **más bajo** de un chunk correcto y el score **más alto** de una pregunta fuera del corpus. `minScore` va entre los dos. "De dónde salió este número" es de las cosas que Tether mira en la documentación técnica.

⚠️ **No copiar el `UMBRAL_DISTANCIA = 1.1` de `lab-05-respuesta-con-cita.md` ni las distancias de `lab-04-chunking-y-lancedb.md`.** Esos labs miden con el default de LanceDB (**L2**), sin `.distanceType('cosine')`. Son escalas distintas.

**Fuera de alcance, a propósito** (van al README como límites conocidos, Step 9):
- Precargar el modelo de embeddings en `AgentService.preload()`.
- Huella de configuración: si cambia `CHUNK_OPTIONS` o el modelo de embeddings, el ingest no lo detecta. Hay que `rm -rf .lancedb`.
- LanceDB no ve escrituras de **otro proceso** por defecto (`readConsistencyInterval` sin setear): si se corre el ingest con el servidor prendido, el servidor sigue viendo la versión vieja hasta reiniciarlo.
- `.csv`/`.json` chunkeados como texto crudo, y `.html` con sus etiquetas.
- Búsqueda híbrida (embeddings + palabras clave), barrido de `chunkSize` con `recall@k`.
- `ai/demo.ts` y `speech/demo.ts` siguen con el store falso.
- El formato de `citations` en la respuesta de la API — **es el Ticket 2**. El alias `corpus:ingest` para `qvac-eval.json` — **es el Ticket 9**.

### Bloques (~50 líneas cada uno)

- **Bloque A** — `ragDemo.ts` reescrito + evaluación "después" (Steps 1–3)
- **Bloque B** — `minScore` medido + `server.ts` (Steps 4–5)
- **Bloque C** — la prueba en la app real: antes/después y reinicio (Step 6)
- **Bloque D** — comentarios + README (Steps 7–9)

---

- [ ] **Step 1: Reescribir el armado de dependencias en `apps/backend/src/ai/ragDemo.ts`**

Reemplazar los imports de `FakeEmbeddingPort` / `buildFixtureVectorStore` / `RagRetrievalConfig` por:

```ts
import { QvacEmbeddingAdapter } from "../rag/infra/qvacEmbedding.adapter.js";
import { LanceDbVectorStore } from "../rag/infra/lanceDbVectorStore.js";
import { VECTOR_DB_DIR } from "../config/rag.config.js";
```

Borrar la constante `DEMO_RAG_CONFIG` y su comentario (hablaban del `FakeEmbeddingPort`). Dentro de `main()`, reemplazar las 3 líneas que construyen `embeddingPort` / `vectorStore` / `ragService` por:

```ts
  if (!(await LanceDbVectorStore.exists(VECTOR_DB_DIR))) {
    throw new Error(`No vector store at ${VECTOR_DB_DIR}. Run "npm run ingest --workspace=apps/backend" first.`);
  }

  const embeddingPort = new QvacEmbeddingAdapter(service);
  const vectorStore = await LanceDbVectorStore.open(VECTOR_DB_DIR);
  // No config override any more: DEFAULT_RAG_CONFIG's thresholds are measured
  // against this exact embedding model, so the demo and the server share one
  // tuning instead of the demo carrying its own.
  const ragService = new RagRetrievalService(embeddingPort, vectorStore);
```

El `service.unloadAll()` del cleanup que ya existe también descarga el modelo de embeddings: quedó registrado en el mismo `ModelManagementService`. No hace falta agregar nada.

- [ ] **Step 2: Correr el demo**

```bash
npm run rag-demo --workspace=apps/backend
```

Expected: la pregunta del SLA se contesta con contexto real del corpus (4 horas). Con `minScore` todavía en `0.65`, la de Marte **puede** contestarse o caer en `insufficientContext`: eso lo arregla el Step 4.

- [ ] **Step 3: Evaluación "después" — las mismas 10 preguntas, ahora contra LanceDB**

```bash
cd apps/backend
npx tsx ../../../qvac-lab/verificacion/retrieval-eval.ts lance | tee ../../../qvac-lab/verificacion/eval-despues.txt
cd ../..
diff ../qvac-lab/verificacion/eval-antes.txt ../qvac-lab/verificacion/eval-despues.txt
```

Expected: `Aciertos (archivo correcto en el top 4): ≥ 7/10`, contra el número del "antes" (como mucho 5/10, y con las preguntas 2, 3, 5, 6 y 8 imposibles). **Este es el contraste que demuestra el ticket:** misma prueba, mismo script, solo cambió el store. La mejor evidencia está en esas 5 preguntas imposibles: pasan de "no puede" a "encuentra".

Cómo leer el resultado:
- **≥ 7/10:** listo.
- **Entre 4 y 6:** mirar las filas `NO`. Si el `top` de esas preguntas es un archivo que **también** menciona el dato (por ejemplo, el SLA aparece en 4 archivos), el ranking está bien y el JSON del lab se quedó corto en `tambien_en`. Anotarlo y seguir. Si el `top` no tiene nada que ver, frenar y revisar: que el ingest haya escrito ~100 filas (T8 Step 2), que `source` no empiece con `corpus/` (T8 Step 6), y que la dimensión sea 768.
- **≤ 3/10:** algo está mal. No seguir.

- [ ] **Step 4: Fijar `minScore` con los números medidos**

De `eval-despues.txt`, tomar:
- `A` = *score más bajo de un chunk correcto*
- `B` = *el más alto de las 8 preguntas sin respuesta*
- La lista de las preguntas sin respuesta marcadas con `<- pasaría un umbral en A`

**La regla:**
- **Si `A > B`** (no se solapan): `minScore = (A + B) / 2`, redondeado a 2 decimales. Todas las correctas pasan y ninguna sin respuesta recibe contexto.
- **Si `A ≤ B`** (se solapan, lo esperable con las 5 que suenan a Meridian): `minScore = A - 0.02`, redondeado a 2 decimales. Todas las correctas siguen pasando. En el comentario de la constante se anotan las preguntas sin respuesta que quedan por encima.

#### ⚖️ La decisión de este paso: ¿el umbral protege las respuestas buenas o frena el ruido?

Cuando los dos grupos se solapan, no hay un número que haga las dos cosas. Hay que elegir qué error es más barato.

- **Cortar un chunk correcto** (umbral alto): la pregunta pierde su contexto *y* su cita. Tether **solo** pregunta cosas que tienen respuesta en el corpus (*"We will ask factual questions answerable from the provided corpus"*) y verifica la cita. Cada chunk correcto cortado es un punto perdido seguro.
- **Dejar pasar ruido** (umbral bajo): una pregunta sin respuesta recibe un par de fragmentos que no la contestan. Frenar eso no depende solo de este número: hay una segunda defensa, `GROUNDING_INSTRUCTIONS` (`ai/orchestrator/ragGraph.const.ts`), que le dice al modelo *"If the answer cannot be supported by the retrieved context, state that the available documents do not contain enough information"*.

| Regla si se solapan | Cuándo conviene | Cuándo no |
|---|---|---|
| **Justo debajo del peor correcto, `A - 0.02`** (elegida) | Cuando lo que se evalúa son preguntas con respuesta, y hay otra defensa contra el ruido (el prompt). Prioriza no perder respuestas buenas. | Si el umbral fuera la **única** defensa, por ejemplo un sistema que cita todo lo que recupera sin pasar por un modelo. |
| **Justo encima del ruido, `B + 0.01`** (la versión anterior de este plan) | Un producto donde contestar algo sin respaldo es mucho peor que decir "no sé", y nadie mide cuántas respuestas buenas se pierden. | **Acá:** corta respuestas que Tether sí va a preguntar, para frenar preguntas que Tether no va a hacer. |

**Diferencia con el proyecto real:** esto **es** el proyecto real. La única diferencia es que la prueba sin respuesta la hacemos nosotros y no Tether. Si el equipo quiere medir cuántas de las 5 que suenan a Meridian terminan con un número inventado, esa prueba es de respuesta, no de recuperación, y es del Ticket 2 (citas).

En `apps/backend/src/rag/service/rag.service.const.ts`, reemplazar el comentario y `minScore` (los otros tres campos no se tocan):

```ts
/**
 * Tuned for EmbeddingGemma-300M-Q4_0 with cosine similarity, measured on
 * <FECHA> against the real corpus: the 10 questions of
 * qvac-lab/preguntas-eval.json, asked in English, plus 8 questions with no
 * answer in the corpus (5 of them phrased to sound like Meridian's own).
 * Lowest-scoring correct chunk within the top 4: A_MEDIDO. Best unanswerable
 * match: B_MEDIDO.
 * RULE_USADA - if the two overlapped, `minScore` sits just below A on
 * purpose: the evaluation only asks answerable questions, so cutting a
 * correct chunk costs more than letting noise through, and the grounding
 * prompt is the second line of defence against that noise. Unanswerable
 * questions still above the threshold: LISTA_O_NINGUNA.
 * These numbers are embedding-model specific - swapping the model means
 * re-measuring, not guessing.
 */
export const DEFAULT_RAG_CONFIG: RagRetrievalConfig = {
  topK: 5,
  minScore: MIN_SCORE_MEDIDO,
  maxContextChunks: 4,
  dedupeExactContent: true
};
```

**Reemplazar `<FECHA>`, `A_MEDIDO`, `B_MEDIDO`, `RULE_USADA` (`"No overlap: midpoint of A and B."` o `"Overlap: A - 0.02."`), `LISTA_O_NINGUNA` y `MIN_SCORE_MEDIDO` por lo que salió.** `MIN_SCORE_MEDIDO` no compila, a propósito. Los del comentario no rompen nada, pero los atrapa el `git grep` del Step 9.

Volver a correr `npm run rag-demo --workspace=apps/backend`. Expected: SLA contestado. Marte debería caer en `insufficientContext`, salvo que aparezca marcado en la lista de `eval-despues.txt` (lo cual sería raro para una pregunta genérica). Si aparece marcado, se anota y se sigue: la regla ya lo tiene en cuenta.

- [ ] **Step 5: Enchufar LanceDB en `apps/backend/src/server.ts`**

**a)** Borrar estos tres imports:

```ts
import { FakeEmbeddingPort } from "./rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "./rag/infra/fixtures/corpus-chunks.fixture.js";
import type { RagRetrievalConfig } from "./rag/domain/types.js";
```

y agregar, junto a `import { RagRetrievalService } ...` (que se queda):

```ts
import { QvacEmbeddingAdapter } from "./rag/infra/qvacEmbedding.adapter.js";
import { LanceDbVectorStore } from "./rag/infra/lanceDbVectorStore.js";
import { VECTOR_DB_DIR } from "./config/rag.config.js";
```

**b)** Reemplazar el bloque entero desde `/** PLACEHOLDER: FakeEmbeddingPort ...` hasta `const ragService = new RagRetrievalService(embeddingPort, vectorStore, RAG_CONFIG);` (incluye el `RAG_CONFIG` local con `minScore: 0.3`) por:

```ts
/**
 * Retrieval over the persisted LanceDB table written by `npm run ingest`,
 * queried with EmbeddingGemma through the same `ModelManagementService` as
 * the chat model: one QVAC worker, one owner of `close()`, and `unloadAll()`
 * on shutdown releases both models. The server only READS the table - it
 * never ingests - so a restart never re-embeds the corpus.
 */
if (!(await LanceDbVectorStore.exists(VECTOR_DB_DIR))) {
  throw new Error(`No vector store at ${VECTOR_DB_DIR}. Run "npm run ingest --workspace=apps/backend" first.`);
}
const embeddingPort = new QvacEmbeddingAdapter(modelManagementService);
const vectorStore = await LanceDbVectorStore.open(VECTOR_DB_DIR);
const ragService = new RagRetrievalService(embeddingPort, vectorStore);
```

La línea `const agentService = new AgentService(modelManagementService, ragService);` y todo lo que sigue quedan **igual**.

Verificar que el servidor falla bien sin tabla:

```bash
mv .lancedb /tmp/lancedb-backup
npm run dev:server
```

Expected: el proceso termina con `No vector store at .../.lancedb. Run "npm run ingest --workspace=apps/backend" first.` (con `tsx watch` queda esperando cambios: cortar con Ctrl+C). Después restaurar: `mv /tmp/lancedb-backup .lancedb`.

- [ ] **Step 6: "Después" en la app real — la misma pregunta de la Tarea 0, y reiniciando**

En una terminal: `npm run dev:server`. En otra:

```bash
VERIF=/Users/lucasrohr/Documents/SpaceDev/Hackathon/qvac-lab/verificacion
ask() {
  curl -sN -X POST localhost:3001/v1/chat/completions \
    -H 'content-type: application/json' \
    -d '{"messages":[{"role":"user","content":"What is the maximum discount an Account Executive can approve without additional approval?"}]}'
}
curl -s -X POST localhost:3001/api/chat/preload
until curl -s localhost:3001/api/chat/status | grep -q '"ready"'; do sleep 3; done
ask | tee $VERIF/app-despues-1.txt
```

Expected: la respuesta dice **10%**, que es lo que dice `emails/014-discount-authority.md`. Comparar con `app-antes.txt` de la Tarea 0.

> ⚠️ **Dependencia de un bug que no es de este ticket** (punto 0 de `docs/2026-09-24-reunion-equipo-conflictos-merge.md`): `graph.ts` manda primero un system prompt de "asistente de stock" y el modelo rechaza cualquier pregunta que no sea de stock, **aunque el RAG haya recuperado el chunk correcto**. Si ese arreglo no está mergeado cuando llegues acá, la respuesta va a ser un rechazo, y eso **no** dice nada sobre este ticket. En ese caso la prueba de esta tarea es de recuperación, no de respuesta: agregar temporalmente (sin commitear) un `console.log(result.chunks.map(c => c.source))` después del `retrieve()` en el nodo `rag` de `graph.ts`, y verificar que en los logs del servidor aparezca `emails/014-discount-authority.md`, antes y después del reinicio. El chequeo de `_versions/` de abajo no depende del modelo y vale igual.

Ahora **el criterio de aceptación**: cortar el servidor con Ctrl+C, verificar que la tabla no se tocó, y volver a arrancar:

```bash
ls .lancedb/chunks.lance/_versions > $VERIF/versiones-antes-reinicio.txt
# (Ctrl+C en la terminal del servidor, y otra vez: npm run dev:server)
curl -s -X POST localhost:3001/api/chat/preload
until curl -s localhost:3001/api/chat/status | grep -q '"ready"'; do sleep 3; done
ask | tee $VERIF/app-despues-2.txt
ls .lancedb/chunks.lance/_versions | diff $VERIF/versiones-antes-reinicio.txt - && echo "OK: la tabla no se escribió"
```

Expected:
- Otra vez **10%**, sin haber corrido `npm run ingest` entre los dos arranques.
- `OK: la tabla no se escribió`. LanceDB agrega un archivo `*.manifest` en `_versions/` con **cada** escritura (verificado en la tabla del Lab 4: los nombres son números invertidos, como `18446744073709551614.manifest`, por eso se compara el listado entero y no "el último"). Que el listado sea idéntico prueba que el servidor no re-embebió nada: solo leyó.
- En los logs del servidor no aparece ningún `Ingesting ...`.

Cortar el servidor al terminar.

- [ ] **Step 7: Actualizar los comentarios de los dobles de test**

En `inMemoryVectorStore.ts`, el comentario dice *"Replace with a real local adapter (e.g. `LanceDbVectorStore`) later without changing `RagRetrievalService` or its callers."* Reemplazar esa frase por:

```
 * Kept as a test double now that `LanceDbVectorStore` is the real adapter:
 * it lets retrieval logic be exercised without a LanceDB directory on disk.
```

En `fakeEmbedding.adapter.ts`, reemplazar *"Replace with a real local embedding adapter later without changing `RagRetrievalService` or its callers."* por:

```
 * Kept as a test double now that `QvacEmbeddingAdapter` is the real adapter.
```

En `config/models.config.ts` no queda nada que tocar: la Tarea 2 ya reemplazó el bloque `EMBEDDINGGEMMA_300M_Q4_0_MODEL_NAME`, que decía que el embedder falso era el activo.

- [ ] **Step 8: Documentar el flujo en `apps/backend/README.md`**

El README tiene esta estructura en `28d5335`: `Setup` → `Scripts` → `Project structure` → `Local Model Management` → `Local Text-to-Speech (TTS)` → `Conventions`. Hacer **tres** cambios:

**a)** En `## Scripts`, agregar la línea de `npm run ingest`, con el mismo formato que las otras.
**b)** En `## Project structure`, agregar `src/rag/` (o actualizarlo si ya figura) mencionando `infra/`, `ingest/` y `service/`.
**c)** Agregar una sección nueva **antes de `## Conventions`**, al mismo nivel que `## Local Model Management`:

```markdown
## RAG: corpus ingestion

The vector store is file-backed (LanceDB) and lives in `.lancedb/` at the
repo root. It is **derived data**: gitignored, and rebuilt by

    npm run ingest --workspace=apps/backend

Run it before starting the server: the server only reads the table and
refuses to start without it. It never ingests on its own, so restarting it
never re-embeds the corpus.

Ingestion is incremental. Every document is hashed (SHA-256 of its content)
and the hash is stored on each of its chunk rows, so the table itself is the
record of what has been ingested - there is no separate state file to drift
out of sync. A document whose hash is unchanged is never re-chunked and never
re-embedded. A changed
document has its own chunks replaced, by `source`, without touching the
others. A document deleted from `corpus/` has its chunks removed on the next
run. To force a full rebuild: `rm -rf .lancedb`.

Paths stored in the table (and therefore in citations) are relative to
`corpus/` — `reports/q1-2026-sales-summary.md`, never `corpus/reports/...`.

Embeddings come from `EMBEDDINGGEMMA_300M_Q4_0` (768 dimensions) through the
SDK's `embed()`; chunking through `ragChunk()`. The SDK's own RAG workspace
(`ragIngest()`/`ragSearch()`) is deliberately not used — the challenge
excludes it for this requirement.

### Known limitations

- **Changing `CHUNK_OPTIONS` or the embedding model is not detected.** The
  ingest state tracks document content only, so unchanged documents are
  skipped even if they would now be chunked or embedded differently. After
  changing either one: `rm -rf .lancedb && npm run ingest --workspace=apps/backend`.
- **The server does not see a re-ingest until it restarts.** LanceDB is
  opened without `readConsistencyInterval`, so writes from another process
  are not picked up by an already-open table.
- **The embedding model loads on the first question**, not in
  `POST /api/chat/preload`: that first answer is a few seconds slower, and
  `/api/chat/status` reports `ready` once the chat model alone is loaded.
- `.csv`/`.json` files are chunked as raw text, and `.html` keeps its tags.
- An empty document produces no chunks and therefore no rows, so every run
  re-reads it and reports it as `added` (it is never embedded - there is
  nothing to embed). The corpus has no empty documents today.
- `corpus/pictures/` is not ingested: `ragChunk()` takes text only. Both images
  are photos with no readable text or figures (checked by eye), so nothing
  answerable is lost today; a corpus with scanned documents would need OCR.
- `ai/demo.ts` and `speech/demo.ts` still use the in-memory fixture store.
```

- [ ] **Step 9: Comparar contra la línea de base, una última vez**

Correr el comando de comparación de la Tarea 0, Step 2.
Expected: `OK: sin fallas nuevas`. Confirmar además que no quedó ningún placeholder:

```bash
git grep -n "<FECHA>\|A_MEDIDO\|B_MEDIDO\|RULE_USADA\|LISTA_O_NINGUNA\|MIN_SCORE_MEDIDO\|FakeEmbeddingPort" -- apps/backend/src/server.ts apps/backend/src/ai/ragDemo.ts apps/backend/src/rag/service/rag.service.const.ts
```

Expected: sin resultados.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/ai/ragDemo.ts apps/backend/src/server.ts \
  apps/backend/src/rag/service/rag.service.const.ts \
  apps/backend/src/rag/infra/inMemoryVectorStore.ts \
  apps/backend/src/rag/infra/fakeEmbedding.adapter.ts \
  apps/backend/README.md
git status --short   # no debe aparecer nada de qvac-lab/ ni de .lancedb/
git commit -m "feat(rag): serve retrieval from the persistent LanceDB store"
```

- [ ] **Step 11: Abrir el PR**

```bash
git push -u origin feat/persistent-vector-store
```

Abrir el PR hacia `main` con `/workflow:pull-request`. En la descripción, pegar como evidencia:
1. Los 6 checks del DoD de la Tarea 8.
2. El resumen de `eval-antes.txt` vs `eval-despues.txt` (aciertos antes → después, las 5 preguntas imposibles del "antes", y los números `A`/`B` con la regla que se usó para `minScore`).
3. `app-antes.txt` vs `app-despues-1.txt` / `app-despues-2.txt`, y las dos versiones iguales de `_versions`.
4. La salida de `OK: sin fallas nuevas`, y la lista de las 3 fallas que ya estaban en `main`, aclarando que no son de este PR.

---

## Definition of Done (del ticket, con dónde se verifica cada uno)

- [ ] Corre el ingest dos veces seguidas: la segunda dice 0 re-embebidos → **T7 Step 6** (test) + **T8 Step 3** (real)
- [ ] Toco un archivo del corpus → la segunda corrida re-embebe solo ese → **T7 Step 6** + **T8 Step 4**
- [ ] Borro un archivo del corpus → sus chunks desaparecen de la tabla → **T7 Step 6** + **T8 Step 5**
- [ ] Mato el proceso, arranco de nuevo, busco: encuentra sin re-embeber → **T8 Step 7** (script) + **T9 Step 6** (el servidor real, con `_versions/` sin cambios)
- [ ] `source` en la tabla es relativo a la raíz del corpus → **T5 Step 5** + **T8 Step 6**
- [ ] La dimensión de la tabla coincide con la del modelo (768) → **T2 Step 9** + **T7 Step 6** (el test del mismatch)

## Criterios de aceptación del ticket (textual)

- [ ] *Embeddings survive application restart* → **T8 Step 7** + **T9 Step 6** (reiniciar `server.ts` y seguir contestando sin ingest)
- [ ] *Vector search works locally* → **T3 Step 4** + **T9 Steps 2–3** ("antes" medido → `≥ 7/10`)
- [ ] *Already-ingested unchanged documents are not unnecessarily re-embedded* → **T7 Step 6** + **T8 Step 3**

## Requisito `[2.3]` del challenge

- [ ] Vector store local y file-backed (LanceDB) → T3, T4
- [ ] Poblado a través de `ragChunk()` y `embed()` → T7 (`QvacChunker`), T2 (`QvacEmbeddingAdapter`)
- [ ] Dimensión igualada al modelo de embeddings → T7 (chequeo explícito)
- [ ] `ragIngest()`/`ragSearch()` **no** usados → verificable con `grep -rn "ragIngest\|ragSearch" apps/backend/src` → sin resultados

## Verificación antes / después (resumen)

| Qué se mide | Antes (T0) | Después | Archivo de evidencia en `$VERIF` |
|---|---|---|---|
| Fallas de tests y tipos | Foto de `main` (3 tests, 5 errores de `tsc`) | Mismas, **ninguna nueva** (cada tarea) | `tests-antes.txt`, `tsc-antes.txt` / `*-ahora.txt` |
| Archivo correcto en el top 4, 10 preguntas en inglés | `≤ 5/10` (store falso, 5 imposibles) | `≥ 7/10` (T9 Step 3) | `eval-antes.txt` / `eval-despues.txt` |
| La app contesta "autoridad de descuento de un AE" | No (no está en los fixtures) | **10%** (T9 Step 6) | `app-antes.txt` / `app-despues-1.txt` |
| Reiniciar la app no re-embebe | — | Misma respuesta y `_versions/` idéntico (T9 Step 6) | `app-despues-2.txt`, `versiones-antes-reinicio.txt` |
| Ingest incremental | — | Los 6 checks de la T8 | salida de la terminal (va a la descripción del PR) |

## Para avisar al equipo (no se arregla en este ticket)

`main` en `28d5335` tiene 3 archivos de test rotos y 5 errores de `tsc` que no son de este ticket: `fullCorpusContext.test.ts` y `corpusContext.test.ts` importan módulos que no existen (uno importa `./corpusContext.ts~`, un archivo de respaldo de un editor), `agentService.test.ts` espera texto de garantía que el RAG falso con `minScore: 0.65` no recupera, y hay imports sin usar en `agentService.ts`, `graph.ts` y `qvacChatModel.ts`. Mencionarlo en el PR y en el canal del equipo.
