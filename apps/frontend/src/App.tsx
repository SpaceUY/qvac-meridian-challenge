import { AppShell } from '@/components/app-shell'
import { ChatPanel } from '@/components/chat-panel'
import { CorpusPanel } from '@/components/corpus-panel'
import { EnginePanel } from '@/components/engine-panel'
import { FAKE_CORPUS } from '@/lib/fake-data'
import { useModelStatus } from '@/hooks/use-model-status'

export default function App() {
  const modelStatus = useModelStatus()
  return (
    <AppShell
      leftSidebar={<CorpusPanel documents={FAKE_CORPUS} />}
      rightSidebar={
        <EnginePanel
          model={modelStatus.model}
          modelStatus={modelStatus.status}
          statusError={modelStatus.error}
          cancelled={modelStatus.cancelled}
          onCancelLoad={modelStatus.cancelLoad}
          onRetryLoad={modelStatus.retryLoad}
        />
      }
    >
      <ChatPanel modelStatus={modelStatus.status} />
    </AppShell>
  )
}
