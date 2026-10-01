import { AppShell } from '@/components/app-shell'
import { ChatPanel } from '@/components/chat-panel'
import { CorpusDialog } from '@/components/corpus-dialog'
import { EnginePanel } from '@/components/engine-panel'
import { NewChatButton } from '@/components/new-chat-button'
import { PrivacyNote } from '@/components/privacy-note'
import { SidebarSection } from '@/components/sidebar-section'
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
          <div className="flex flex-col gap-6">
            <NewChatButton />
            <SidebarSection title="Knowledge">
              <CorpusDialog />
            </SidebarSection>
            <EnginePanel
              model={modelStatus.model}
              modelStatus={modelStatus.status}
              statusError={modelStatus.error}
              hardwareTier={modelStatus.hardwareTier}
              sttModel={modelStatus.sttModel}
              ttsModel={modelStatus.ttsModel}
              delegation={modelStatus.delegation}
              providerHealth={modelStatus.providerHealth}
              recovering={modelStatus.recovering}
              serverUnreachable={modelStatus.serverUnreachable}
              cancelled={modelStatus.cancelled}
              onCancelLoad={modelStatus.cancelLoad}
              onRetryLoad={modelStatus.retryLoad}
            />
          </div>
        }
        leftFooter={modelStatus.delegation?.isDelegated ? undefined : <PrivacyNote />}
      >
        <ChatPanel
          modelStatus={modelStatus.status}
          modelCancelled={modelStatus.cancelled}
          embeddingReady={modelStatus.embeddingReady}
          serverUnreachable={modelStatus.serverUnreachable}
        />
      </AppShell>
    </>
  )
}
