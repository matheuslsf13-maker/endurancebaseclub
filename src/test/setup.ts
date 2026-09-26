import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library only registers its automatic cleanup when `afterEach` is a global, and Vitest
// runs without `test.globals` — so unmount whatever each test rendered explicitly.
afterEach(() => {
  cleanup();
});
