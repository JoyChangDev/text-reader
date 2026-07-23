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

  const clickBtnsEl = screen.getAllByRole('button', { name: 'Click me' });

  expect(clickBtnsEl).toHaveLength(2);
  clickBtnsEl.forEach((el) => expect(el).toBeEnabled());
});
