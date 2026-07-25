import { describe, expect, test } from 'vitest';

import { POST } from './route';

function jsonRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/chunks', () => {
  test('rejects a request with a missing text field with 400', async () => {
    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
  });

  test('rejects a request with an empty text string with 400', async () => {
    const response = await POST(jsonRequest({ text: '' }));

    expect(response.status).toBe(400);
  });

  test('returns the ordered chunk list for a given text', async () => {
    const text = '今天天氣很好。我們去公園散步。路上遇到了朋友！大家一起聊天。';

    const response = await POST(jsonRequest({ text }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chunks.join('')).toBe(text);
    expect(body.chunks.length).toBeGreaterThan(0);
  });
});
