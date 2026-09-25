import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

// Ruling 7: Vitest runs without globals, so Testing Library cannot register its automatic
// cleanup; src/test/setup.ts does it. These two tests run in order and prove it.
describe('test setup', () => {
  it('renders into the document with the jest-dom matchers available', () => {
    render(<p>primeiro teste</p>);
    expect(screen.getByText('primeiro teste')).toBeInTheDocument();
  });

  it('unmounts whatever the previous test rendered', () => {
    expect(screen.queryByText('primeiro teste')).not.toBeInTheDocument();
    expect(document.body).toBeEmptyDOMElement();
  });
});
