import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ToastProvider } from '../components/ui/Toast';
import { ConfirmProvider } from '../components/ui/Confirm';

export interface RenderWithProvidersOptions {
  route?: string;
  path?: string;
}

export function renderWithProviders(ui: ReactElement, { route = '/', path = '*' }: RenderWithProvidersOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const router = createMemoryRouter(
    [
      {
        path,
        element: (
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ConfirmProvider>{ui}</ConfirmProvider>
            </ToastProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: [route] },
  );

  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}
