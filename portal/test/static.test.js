import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startTestApp } from './helpers.js';

describe('静态资源缓存', () => {
  let app;

  before(async () => {
    app = await startTestApp();
  });

  after(async () => {
    await app.close();
  });

  it('静态资源返回 ETag / Last-Modified，重复请求返回 304', async () => {
    const first = await fetch(`${app.baseUrl}/assets/css/base.css`);
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag');
    assert.ok(etag, '应返回 ETag');
    assert.ok(first.headers.get('last-modified'), '应返回 Last-Modified');
    assert.match(first.headers.get('cache-control') || '', /no-cache/);
    await first.text();

    const second = await fetch(`${app.baseUrl}/assets/css/base.css`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(second.status, 304, '条件请求应返回 304');
    assert.equal((await second.text()).length, 0);
  });

  it('HTML 入口不缓存', async () => {
    const html = await fetch(`${app.baseUrl}/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('cache-control') || '', /no-store/);
  });
});
