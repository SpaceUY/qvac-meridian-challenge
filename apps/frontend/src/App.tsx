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
