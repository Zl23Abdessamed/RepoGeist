import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { SolidQueryDevtools } from '@tanstack/solid-query-devtools'
import { type ParentComponent } from 'solid-js'

// Create the QueryClient outside the component so it's a singleton
const queryClient = new QueryClient()

const AppProvider: ParentComponent = (props) => {
  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
      <SolidQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}

export default AppProvider