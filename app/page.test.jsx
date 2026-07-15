import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import ChakraProvider from './_providers/chakra';
import Home from './page';

test('renders the home page buttons', () => {
  render(
    <ChakraProvider>
      <Home />
    </ChakraProvider>,
  );

  expect(screen.getAllByRole('button', { name: 'Click me' })).toHaveLength(2);
});
