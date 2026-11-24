import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { UpdateService, compareVersions, tagVersion } from '../src/services/update-service.js';

function makeService(overrides = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-update-test-'));
  fs.writeFileSync(path.join(rootDir, 'VERSION'), '1.0.0\n');
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const config = {
    rootDir,
    dataDir,
    deployMode: 'systemd',
    update: { repo: 'me/my-3x-ui', mirror: '' },
    ...overrides,
  };
  const service = new UpdateService({ config });
  return { service, rootDir, dataDir };
}

describe('门户更新服务', () => {
  it('版本比较与标签归一化', () => {
    assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
    assert.equal(tagVersion('portal-v1.2.3'), '1.2.3');
    assert.equal(tagVersion('v1.2.3'), '1.2.3');
  });

  it('初始状态读取 VERSION，尚无更新结果与心跳', () => {
    const { service } = makeService();
    const status = service.status();
    assert.equal(status.currentVersion, '1.0.0');
    assert.equal(status.latestVersion, '');
    assert.equal(status.upToDate, null);
    assert.equal(status.pending, false);
    assert.equal(status.canApply, true);
    assert.equal(status.repo, 'me/my-3x-ui');
    assert.equal(status.runner.healthy, false);
    assert.equal(status.runner.lastHeartbeatAt, null);
  });

  it('读取更新执行器心跳，判断服务是否在运行', () => {
    const { service, dataDir } = makeService();
    const updateDir = path.join(dataDir, 'update');
    fs.mkdirSync(updateDir, { recursive: true });

    fs.writeFileSync(path.join(updateDir, 'heartbeat.json'), JSON.stringify({ at: Date.now(), action: 'idle' }));
    const healthy = service.status().runner;
    assert.equal(healthy.healthy, true);
    assert.equal(healthy.lastAction, 'idle');
    assert.ok(healthy.lastHeartbeatAt > 0);

    fs.writeFileSync(path.join(updateDir, 'heartbeat.json'), JSON.stringify({ at: Date.now() - 10 * 60 * 1000 }));
    assert.equal(service.status().runner.healthy, false);
  });

  it('检查更新任务写入 request，运行器结果可被读取并比较版本', () => {
    const { service, dataDir } = makeService();
    const queued = service.enqueue('check');
    assert.equal(queued.queued, true);

    const requestFile = path.join(dataDir, 'update', 'request.json');
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    assert.equal(request.action, 'check');
    assert.equal(request.repo, 'me/my-3x-ui');
    assert.equal(service.status().pending, true);

    assert.throws(() => service.enqueue('apply'), (err) => err.code === 'update_busy');

    fs.writeFileSync(
      path.join(dataDir, 'update', 'result.json'),
      JSON.stringify({
        status: 'checked',
        latestTag: 'portal-v1.0.1',
        releaseUrl: 'https://github.com/me/my-3x-ui/releases/tag/portal-v1.0.1',
        checkedAt: Date.now(),
        at: Date.now(),
      }),
    );
    fs.rmSync(requestFile, { force: true });

    const status = service.status();
    assert.equal(status.latestVersion, '1.0.1');
    assert.equal(status.upToDate, false);
    assert.equal(status.releaseTag, 'portal-v1.0.1');
    assert.match(status.releaseUrl, /portal-v1\.0\.1$/);
    assert.equal(status.pending, false);
  });

  it('已是最新时不提示更新，可读取运行器失败原因', () => {
    const { service, dataDir } = makeService();
    const updateDir = path.join(dataDir, 'update');
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(
      path.join(updateDir, 'result.json'),
      JSON.stringify({ status: 'checked', latestTag: 'portal-v1.0.0', checkedAt: Date.now(), at: Date.now() }),
    );
    assert.equal(service.status().upToDate, true);

    fs.writeFileSync(
      path.join(updateDir, 'result.json'),
      JSON.stringify({ status: 'failed', message: '下载更新包失败（HTTP 404）', at: Date.now() }),
    );
    const status = service.status();
    assert.equal(status.result.status, 'failed');
    assert.match(status.result.message, /404/);
  });

  it('检查请求超时后不再阻塞重新发起', () => {
    const { service, dataDir } = makeService();
    const updateDir = path.join(dataDir, 'update');
    fs.mkdirSync(updateDir, { recursive: true });
    fs.writeFileSync(
      path.join(updateDir, 'request.json'),
      JSON.stringify({ action: 'check', repo: 'me/my-3x-ui', requestedAt: Date.now() - 5 * 60 * 1000 }),
    );
    const status = service.status();
    assert.equal(status.pending, false);
    assert.equal(status.requestStale, true);

    const queued = service.enqueue('check');
    assert.equal(queued.queued, true);
    assert.equal(service.status().pending, true);
  });

  it('非 systemd 部署或未配置仓库时拒绝一键更新', () => {
    const local = makeService({ deployMode: 'docker' }).service;
    assert.equal(local.status().canApply, false);
    assert.throws(() => local.enqueue('check'), (err) => err.code === 'update_unavailable');

    const noRepo = makeService({ update: { repo: '', mirror: '' } }).service;
    assert.equal(noRepo.status().canApply, false);
    assert.throws(() => noRepo.enqueue('apply'), (err) => err.code === 'update_not_configured');
  });
});
