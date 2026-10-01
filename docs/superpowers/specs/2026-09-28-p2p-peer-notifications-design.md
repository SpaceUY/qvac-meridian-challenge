# P2P: peers disponibles + notificaciones — Design

**Fecha:** 28/09/2026 · **Rama sugerida:** `feat/p2p-peer-notifications` (desde `origin/main`)
**Autor del pedido:** Lucas · **Estado:** aprobado en brainstorming, sección por sección.

## El pedido, y cómo quedó después de discutirlo

| # | Pedido original | Decisión final |
|---|---|---|
| 1 | Mostrar "Peers available (N)" en el panel de inferencia, mismo estilo burbuja que "30 docs" | `countAvailablePeers()`: hoy da 0 o 1 (un solo peer configurable), pero la función queda lista para N sin tocar el front el día que el backend soporte varios. |
| 2 | Snackbar verde "request delegated to a peer, please wait" en cada pregunta | **Descartado tal cual.** La delegación se decide una sola vez, al cargar el modelo — no por pregunta (ver más abajo). Se reemplaza por un aviso único al **conectar**, no por mensaje. |
| 3 | Snackbar de error si falla la delegación y cae a local | Se mantiene, pero con un matiz clave: sin un cambio de backend, ese aviso llegaría hasta 60s tarde. Se decidió sumar un flag `recovering` al orquestador para que el aviso salga casi al instante. |
| 4 | "Si falla un peer, ¿se delega a otro igual de capaz?" | No hoy: solo hay un peer configurado (`DELEGATE_PROVIDER_PUBLIC_KEY`). Si se cae, se reintenta ese mismo peer y, si sigue caído, cae a local. Soportar varios peers reales es una feature de backend, fuera de alcance de este spec. |

## Cómo funciona el P2P hoy (contexto necesario)

- **Un solo peer configurado.** `DELEGATE_PROVIDER_PUBLIC_KEY` en el backend ([config/delegate.config.ts](../../apps/backend/src/config/delegate.config.ts)) apunta a un único proveedor por clave pública. No hay lista, no hay descubrimiento de "N peers disponibles" — ese número, hoy, solo puede ser 0 o 1.
- **La delegación se decide al cargar el modelo, no por pregunta.** `loadModel({ delegate: { providerPublicKey, fallbackToLocal: true } })` corre una sola vez. Si el peer contesta, **todas** las preguntas de la sesión van a él. Si no, todas corren local.
- **Si el peer se cae a mitad de sesión**, la próxima pregunta falla con `DelegatedProviderUnreachableError`. `recoverFromDelegationFailure()` ([qvacChatModel.ts:362](../../apps/backend/src/ai/orchestrator/qvacChatModel.ts:362)) descarga el modelo, **reintenta el mismo peer** (con un timeout de hasta 60s — el mismo valor que usa el ejemplo oficial del SDK para una búsqueda en frío en la DHT) y, si sigue caído, carga local. Reintenta la pregunta una sola vez.
- **Si ya salieron palabras de la respuesta cuando el peer se cae**, no hay recuperación automática en esa pregunta: el error sale tal cual, y recién la siguiente pregunta dispara la recuperación. Esto no cambia con este spec — queda documentado como limitación conocida más abajo.
- **El front ya lee el estado de delegación** vía `GET /api/chat/status`, poll cada 1s mientras carga y cada 5s en `ready` ([use-model-status.ts](../../apps/frontend/src/hooks/use-model-status.ts)). Hoy ese estado solo alimenta el texto fijo del panel — no dispara ningún aviso.

## Responsabilidad única de cada pieza nueva

Pedido explícito: SOLID a nivel de métodos. Cada pieza nueva hace **una sola cosa** — la tabla es la referencia para no desviarse al implementar.

| Pieza | Responsabilidad única |
|---|---|
| `qvacChatModel.ts` → `recoverFromDelegationFailure()` | Orquestar la recuperación (ya existía) — ahora además marca su propio inicio/fin con el flag. No decide qué mostrar ni a quién avisar. |
| `qvacChatModel.ts` → `isRecovering()` | Exponer el valor actual del flag. Ninguna lógica. |
| `agentService.ts` → `getStatus()` | Ensamblar el payload de estado (ya existía) — agrega un campo más a la misma tarea que ya hacía, no una tarea nueva. |
| `lib/peers.ts` → `countAvailablePeers()` | Convertir `delegation` en un número. Nada más. |
| `lib/peers.ts` → `classifyDelegationTransition()` | Comparar dos fotos de estado (antes/ahora) y decir qué cambió. No sabe de toasts ni de texto. |
| `lib/peer-notification-copy.ts` → `messageFor()` | Traducir un evento a texto + severidad. No sabe de Sonner ni de React. |
| `lib/notifier.ts` → `notifySuccess`/`notifyWarning`/`notifyError` | Mostrar un toast de una severidad dada. No sabe nada de peers. |
| `hooks/use-delegation-notifications.ts` | Conectar las piezas de arriba con el ciclo de vida de React: guardar el valor anterior, reaccionar a los cambios. Sin lógica de negocio propia. |

## Diseño — Backend

Un flag booleano nuevo en `ChatQVAC` (`qvacChatModel.ts`), prendido mientras `recoverFromDelegationFailure()` está en curso:

```ts
private recovering = false;

private async recoverFromDelegationFailure(): Promise<string> {
  this.recovering = true;
  try {
    const staleModelId = await this.modelIdPromise;
    this.modelIdPromise = undefined;
    if (staleModelId) {
      await this.service.unloadModel(staleModelId).catch(() => {});
    }
    const modelId = await this.ensureModel();
    await this.getDelegationInfo();
    return modelId;
  } finally {
    this.recovering = false;
  }
}

isRecovering(): boolean {
  return this.recovering;
}
```

`finally` en vez de dejarlo antes del `return`: si `ensureModel()` también falla (no logra cargar ni local), el `return` normal nunca se ejecuta — un `finally` corre siempre, así el flag nunca queda trabado en `true`.

`agentService.ts` → `getStatus()` suma el campo, sin cambiar su forma de trabajar (ya lee todo en vivo del `chatModel` en cada llamada):

```ts
getStatus(): AgentStatusPayload {
  const delegation = this.chatModel.getCachedDelegationInfo();
  return {
    status: this.status,
    ...(this.statusError ? { error: this.statusError } : {}),
    model: this.modelInfo,
    ...(delegation ? { delegation } : {}),
    recovering: this.chatModel.isRecovering(),
  };
}
```

`AgentStatusPayload` (`agentService.ts`) gana un campo **no opcional** (siempre `boolean`, no `boolean | undefined`) — es más simple de leer en el front que no tener que manejar un tercer valor "no sé":

```ts
export interface AgentStatusPayload {
  status: AgentStatus;
  error?: string;
  model: { name: string; quantization: string };
  delegation?: LoadedModelDelegationInfo;
  recovering: boolean;
}
```

**El router no cambia.** `chat.router.ts` ya sirve `agentService.getStatus()` completo como JSON — el campo nuevo viaja solo.

### Error handling

No se agrega ningún estado de error nuevo. El flag es pura observabilidad sobre un camino que ya existe: si `ensureModel()` dentro de la recuperación falla (no logra cargar ni local), ese error sigue propagándose exactamente como hoy hacia `chatCompleteWithRecovery`/`_streamResponseChunks` — el `finally` solo garantiza que `recovering` vuelva a `false` antes de que el error salga.

## Diseño — Frontend

### `lib/peers.ts` — lógica pura, sin React

```ts
export type DelegationSnapshot = { isDelegated: boolean; recovering: boolean }
export type DelegationEvent = 'connected' | 'recovering-started' | 'reconnected' | 'fell-back-to-local'

export function countAvailablePeers(delegation: DelegationInfo | undefined): number {
  return delegation?.isDelegated ? 1 : 0
}

export function classifyDelegationTransition(
  previous: DelegationSnapshot | undefined,
  current: DelegationSnapshot,
): DelegationEvent | null {
  if (!previous) return null // nada que comparar todavía (primer poll, o recién montado)
  if (!previous.isDelegated && current.isDelegated && !current.recovering) return 'connected'
  if (!previous.recovering && current.recovering) return 'recovering-started'
  if (previous.recovering && !current.recovering) {
    return current.isDelegated ? 'reconnected' : 'fell-back-to-local'
  }
  return null
}
```

El guard `if (!previous) return null` es lo que evita un "Connected!" falso cada vez que se recarga la página con el modelo ya delegado de antes — sin una foto anterior real, no hay transición que reportar.

### `lib/peer-notification-copy.ts` — texto y severidad, sin Sonner ni React

```ts
export type NotificationSeverity = 'success' | 'warning' | 'error'

export function messageFor(event: DelegationEvent): { severity: NotificationSeverity; message: string } {
  switch (event) {
    case 'connected':
      return { severity: 'success', message: 'Connected to a peer — inference running remotely' }
    case 'recovering-started':
      return { severity: 'warning', message: 'Peer down — trying to reconnect…' }
    case 'reconnected':
      return { severity: 'success', message: 'Reconnected to peer' }
    case 'fell-back-to-local':
      return { severity: 'error', message: "Couldn't reconnect — now running locally" }
  }
}
```

### `lib/notifier.ts` — capa fina sobre Sonner, sin saber qué es un "peer"

```ts
import { toast } from 'sonner'

export function notifySuccess(message: string): void { toast.success(message) }
export function notifyWarning(message: string): void { toast.warning(message) }
export function notifyError(message: string): void { toast.error(message) }
```

Sonner no está instalada todavía — se agrega a `apps/frontend/package.json`. **La versión exacta se verifica en npm al implementar**, no se fija de antemano acá (misma disciplina que pide el `CLAUDE.md` raíz para `@qvac/sdk`, aplicada por buena práctica aunque esta regla ahí hable puntualmente del SDK de QVAC).

### `hooks/use-delegation-notifications.ts` — el único lugar que junta todo

```ts
const SEVERITY_NOTIFIERS: Record<NotificationSeverity, (message: string) => void> = {
  success: notifySuccess,
  warning: notifyWarning,
  error: notifyError,
}

export function useDelegationNotifications(snapshot: DelegationSnapshot): void {
  const previousRef = useRef<DelegationSnapshot | undefined>(undefined)

  useEffect(() => {
    const event = classifyDelegationTransition(previousRef.current, snapshot)
    if (event) {
      const { severity, message } = messageFor(event)
      SEVERITY_NOTIFIERS[severity](message)
    }
    previousRef.current = snapshot
  }, [snapshot.isDelegated, snapshot.recovering])
}
```

### Piezas existentes que se tocan

- `model-status-client.ts`: `ModelStatusResponse` gana `recovering: boolean`.
- `use-model-status.ts`: devuelve `recovering` además de lo que ya devuelve, leído de `query.data?.recovering ?? false`.
- `engine-panel.tsx`: nueva fila "Peers available" con `<Badge variant="secondary">{countAvailablePeers(delegation)}</Badge>` — mismo componente `Badge` que ya usa el corpus para "30 docs" ([corpus-dialog.tsx:23](../../apps/frontend/src/components/corpus-dialog.tsx:23)). Reemplaza el texto fijo "No peers available.".
- `App.tsx`: único lugar que ya llama a `useModelStatus()` — monta `<Toaster position="top-center" />` una vez y llama a `useDelegationNotifications({ isDelegated: delegation?.isDelegated ?? false, recovering })`.

## Flujo de datos, de punta a punta

**Caso A — conecta al arrancar:** la app carga, `useModelStatus` empieza a pollear. El primer valor real de `delegation.isDelegated` pasa de `false` (mientras carga) a `true`. `classifyDelegationTransition` devuelve `'connected'` → toast verde, una sola vez.

**Caso B — el peer se cae y no vuelve:** una pregunta falla → `recovering` pasa a `true` en el próximo poll (hasta 5s) → toast amarillo "trying to reconnect". El backend agota el timeout de 60s con el mismo peer, cae a local, `recovering` vuelve a `false` con `isDelegated: false` → toast rojo "now running locally".

**Caso C — el peer se cae y vuelve a responder:** igual que B hasta el toast amarillo. Como `ensureModel()` reintenta el mismo peer antes de rendirse, si contesta a tiempo `recovering` vuelve a `false` con `isDelegated: true` → toast verde "Reconnected to peer".

**Caso D — limitación conocida, sin aviso:** el peer se cae después de que ya salieron palabras de la respuesta en curso. El backend no reintenta en esa pregunta (ver "Cómo funciona el P2P hoy"), `recovering` nunca pasa a `true`, no sale ningún toast — el usuario solo ve el error normal del chat en esa respuesta puntual. La recuperación (y sus toasts) recién arrancan con la **siguiente** pregunta.

## Alternativas descartadas (y por qué)

| Descartado | Por qué |
|---|---|
| Aviso "delegated to a peer" en cada pregunta | La delegación no se decide por pregunta — sería el mismo cartel repetido en toda una charla larga, y deja de leerse. |
| Detectar la caída solo comparando `isDelegated` (sin flag `recovering`) | El aviso llegaría hasta 60s después de la caída real — recién cuando el backend termina de rendirse con el peer muerto. |
| Evento embebido en el stream SSE de la respuesta | Instantáneo, pero no cubre el modo sin stream ni el flujo de voz, y crea dos fuentes de verdad (stream + `/status`) que pueden desincronizarse. |
| `delegation` como un enum de 3 estados (`connected`/`recovering`/`local`) en vez de un booleano `recovering` aparte | Un campo nuevo es un cambio más chico y no rompe la forma que `delegation` ya tiene hoy. Si en el futuro hace falta más granularidad (ej. "reconectando a un peer distinto"), ahí conviene migrar a un enum — no antes. |
| Lista real de N peers con selección | El backend solo soporta un peer configurado hoy (YAGNI). `countAvailablePeers()` ya queda listo para crecer sin tocar el resto del front el día que eso exista. |
| Estado global en Zustand para la delegación | No hay ningún otro componente del árbol que necesite leer el estado de delegación fuera de `App.tsx` → `EnginePanel`. Un `useRef` local al hook alcanza; agregar Zustand sería estado global para un solo consumidor. |

## Requisitos del challenge que toca

- **[5.1] / [5.1.1]** — no agrega delegación nueva, pero hace visible en la UI el fallback que el backend ya implementa: hoy pasa en silencio.

## Testing

- `lib/peers.test.ts`: `countAvailablePeers` (0, 1) y `classifyDelegationTransition` — un caso por cada transición de la tabla (`connected`, `recovering-started`, `reconnected`, `fell-back-to-local`, y el caso `null`: primera foto, o nada cambió).
- `messageFor` y el hook **sin test dedicado**: `messageFor` es una tabla estática sin ramas que puedan fallar (el `switch` ya es exhaustivo por tipos); el hook es puro pegamento de React ya cubierto por los tests de las funciones puras que llama — mismo criterio que ya usa el repo (`citation-label.ts` tiene test porque tiene lógica real; `config.ts` no, porque es glue).
- Backend: extender `qvacChatModel.test.ts` (o `agentService.delegate.test.ts`) con un caso que fuerza `DelegatedProviderUnreachableError`, deja el mock de `ensureModel()` sin resolver todavía, y verifica `isRecovering() === true` en ese punto — luego lo resuelve y verifica que vuelve a `false`.

## Etapas de commit (a detallar en el plan de implementación)

| Etapa | Qué toca | Depende de |
|---|---|---|
| 0 | Flag `recovering` en `qvacChatModel.ts` + `agentService.ts` (backend) | — (a coordinar con el dueño del orquestador) |
| 1 | `countAvailablePeers` + fila "Peers available" en `EnginePanel` | — |
| 2 | Instalar Sonner, montar `<Toaster />`, aviso de conexión (`'connected'`) | — |
| 3 | Aviso de `'recovering-started'` | Etapa 0 |
| 4 | Avisos de resolución (`'reconnected'` / `'fell-back-to-local'`) | Etapa 0, 3 |

Las etapas 1 y 2 no dependen de la 0 y se pueden mergear en cualquier orden. El detalle bloque a bloque de cada etapa lo arma el plan de implementación (`writing-plans`).

## Fuera de alcance

Soporte real para múltiples peers simultáneos en el backend · reconexión automática a un peer *distinto* si el configurado muere (mejora [I.1.3] del challenge, no pedida acá) · aviso para el caso D (falla a mitad de stream con tokens ya emitidos) — documentado como limitación conocida, no resuelto.
