import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './styles/tailwind-frozen-variants.css'
import './styles/app-components-late.css'
import { initRuntime } from './config/runtime'
import { isTauri } from './services/license.service'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

const root = createRoot(document.getElementById('root')!)

// App được import động: các module bên trong đọc địa chỉ backend/worker ngay lúc import,
// nên bản Desktop phải có cấu hình dịch vụ trước.
async function renderApp() {
  const { default: App } = await import('./App.tsx')
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

if (isTauri()) {
  import('./components/DesktopBoot').then(({ default: DesktopBoot }) => {
    root.render(
      <DesktopBoot
        onReady={(cfg, warning) => {
          initRuntime(cfg)
          import('./desktop/links').then(({ installDesktopLinks }) => installDesktopLinks())
          renderApp().then(() => {
            if (warning) import('antd').then(({ message }) => message.warning({ content: warning, duration: 10 }))
          })
        }}
      />,
    )
  })
} else {
  renderApp()
}
