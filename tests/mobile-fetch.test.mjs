import test from 'node:test';
import assert from 'node:assert/strict';
import nativeAbort from 'abort-controller';
import {fetchWithTimeout} from '../apps/mobile/src/fetchWithTimeout.mjs';

test('mobile requests work with the React Native AbortSignal polyfill and still time out', async () => {
  const original = {fetch: globalThis.fetch, AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal};
  try {
    globalThis.AbortController = nativeAbort.AbortController;
    globalThis.AbortSignal = nativeAbort.AbortSignal;
    assert.equal(typeof AbortSignal.timeout, 'undefined');
    const response = new Response('{"ok":true}');
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://example.test/health');
      assert.equal(options.signal.aborted, false);
      return response;
    };
    assert.equal(await fetchWithTimeout('https://example.test/health'), response);

    let aborted = false;
    globalThis.fetch = (_url, {signal}) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {aborted = true; reject(new Error('aborted'));});
    });
    await assert.rejects(fetchWithTimeout('https://example.test/slow', {}, 10), /aborted/);
    assert.equal(aborted, true);
  } finally {
    Object.assign(globalThis, original);
  }
});
