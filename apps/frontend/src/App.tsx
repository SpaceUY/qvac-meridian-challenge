import { AppShell } from '@/components/app-shell'
import { ChatPanel } from '@/components/chat-panel'
import { CorpusDialog } from '@/components/corpus-dialog'
import { EnginePanel } from '@/components/engine-panel'
import { NewChatButton } from '@/components/new-chat-button'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/sonner'
import { useModelStatus } from '@/hooks/use-model-status'
import { useDelegationNotifications } from '@/hooks/use-delegation-notifications'

export default function App() {
  const modelStatus = useModelStatus()
  useDelegationNotifications({
    isDelegated: modelStatus.delegation?.isDelegated ?? false,
    recovering: modelStatus.recovering,
  })
  return (
    <>
      <Toaster />
      <AppShell
        leftSidebar={
          <div className="flex flex-col gap-3">
            <NewChatButton />
            <CorpusDialog />
            <Separator />
            <EnginePanel
              model={modelStatus.model}
              modelStatus={modelStatus.status}
              statusError={modelStatus.error}
              delegation={modelStatus.delegation}
              cancelled={modelStatus.cancelled}
              onCancelLoad={modelStatus.cancelLoad}
              onRetryLoad={modelStatus.retryLoad}
            />
          </div>
        }
      >
        <ChatPanel modelStatus={modelStatus.status} modelCancelled={modelStatus.cancelled} />
      </AppShell>
    </>
  )
}
