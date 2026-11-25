import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';

import { measureTcpLatency } from '../src/services/admin-service.js';

describe('入站实时延迟探测', () => {
  it('对可连接端口返回毫秒数', async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
      const latency = await measureTcpLatency('127.0.0.1', port, 1000);
      assert.ok(Number.isInteger(latency), '延迟应为整数毫秒');
      assert.ok(latency >= 1 && latency < 1000, `延迟异常：${latency}`);
    } finally {
      server.close();
    }
  });

  it('端口不可达或参数非法时返回 null', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));

    assert.equal(await measureTcpLatency('127.0.0.1', port, 300), null);
    assert.equal(await measureTcpLatency('', 443, 300), null);
    assert.equal(await measureTcpLatency('127.0.0.1', 0, 300), null);
  });
});
