import fs from 'node:fs';
import path from 'node:path';

import { errors } from '../util/errors.js';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
const REQUEST_DEBOUNCE_MS = 20 * 1000;

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

export function tagVersion(tag) {
  return String(tag || '')
    .trim()
    .replace(/^portal-v/i, '')
    .replace(/^v/i, '');
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class UpdateService {
  constructor({ config }) {
    this.config = config;
    this.deployMode = String(config.deployMode || 'local');
    this.repo = String(config.update?.repo || '').trim();
    this.mirror = String(config.update?.mirror || '').trim();
    this.updateDir = path.join(config.dataDir, 'update');
    this.requestPath = path.join(this.updateDir, 'request.json');
    this.resultPath = path.join(this.updateDir, 'result.json');
    this.heartbeatPath = path.join(this.updateDir, 'heartbeat.json');
  }

  currentVersion() {
    try {
      const value = fs.readFileSync(path.join(this.config.rootDir, 'VERSION'), 'utf8').trim();
      return value || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  get canApply() {
    return this.deployMode === 'systemd' && REPO_PATTERN.test(this.repo);
  }

  readRequest() {
    const request = readJson(this.requestPath);
    if (!request) return null;
    if (Date.now() - Number(request.requestedAt || 0) > PENDING_MAX_AGE_MS) return null;
    return request;
  }

  readResult() {
    return readJson(this.resultPath);
  }

  runnerHealth() {
    const heartbeat = readJson(this.heartbeatPath);
    const lastHeartbeatAt = heartbeat?.at ? Number(heartbeat.at) : null;
    return {
      lastHeartbeatAt,
      healthy: Boolean(lastHeartbeatAt && Date.now() - lastHeartbeatAt < 5 * 60 * 1000),
      lastAction: heartbeat?.action || '',
    };
  }

  status() {
    const currentVersion = this.currentVersion();
    const result = this.readResult();
    const request = this.readRequest();
    const runner = this.runnerHealth();
    const latestVersion = result?.latestTag ? tagVersion(result.latestTag) : result?.latestVersion || '';
    const hasLatest = Boolean(latestVersion && parseVersion(latestVersion));
    const upToDate = hasLatest ? compareVersions(currentVersion, latestVersion) >= 0 : null;
    // 检查任务 2 分钟、更新任务 10 分钟仍无结果时视为超时，允许用户重新发起。
    const requestAge = request ? Date.now() - Number(request.requestedAt || 0) : 0;
    const requestTimeoutMs = request?.action === 'apply' ? 10 * 60 * 1000 : 2 * 60 * 1000;
    const pending = Boolean(request) && requestAge < requestTimeoutMs;
    return {
      currentVersion,
      latestVersion: latestVersion || '',
      upToDate,
      releaseTag: result?.latestTag || '',
      releaseUrl: result?.releaseUrl || '',
      checkedAt: result?.checkedAt || result?.at || null,
      deployMode: this.deployMode,
      canApply: this.canApply,
      repo: this.repo,
      mirrorConfigured: Boolean(this.mirror),
      installScriptPath: path.join(this.config.rootDir, 'scripts', 'install.sh'),
      pending,
      requestStale: Boolean(request) && !pending,
      request: request ? { action: request.action, requestedAt: request.requestedAt } : null,
      runner,
      result: result
        ? {
            status: result.status || '',
            message: result.message || '',
            at: result.at || null,
            latestTag: result.latestTag || '',
          }
        : null,
    };
  }

  enqueue(action) {
    if (!['check', 'apply'].includes(action)) {
      throw errors.validation('不支持的更新操作');
    }
    if (this.deployMode !== 'systemd') {
      throw errors.badRequest(
        'update_unavailable',
        `当前部署方式不支持门户内一键更新：Docker 部署请拉取新镜像后重启容器；源码部署请在服务器执行 sudo bash ${path.join(this.config.rootDir, 'scripts', 'install.sh')} --upgrade。`,
      );
    }
    if (!REPO_PATTERN.test(this.repo)) {
      throw errors.badRequest(
        'update_not_configured',
        '未配置更新仓库：请在 /etc/portal/portal.env 设置 PORTAL_UPDATE_REPO=你的用户名/仓库名（更新镜像可用 PORTAL_UPDATE_MIRROR）。',
      );
    }
    if (!this.runnerHealth().healthy) {
      throw errors.badRequest(
        'update_runner_unavailable',
        `后台更新服务未运行：请执行 sudo systemctl enable --now portal-update.timer，或 sudo bash ${path.join(this.config.rootDir, 'scripts', 'install.sh')} --upgrade 安装更新服务。`,
      );
    }
    const existing = this.readRequest();
    if (existing && Date.now() - Number(existing.requestedAt || 0) < REQUEST_DEBOUNCE_MS) {
      throw errors.conflict('update_busy', '已有更新任务正在排队，请稍候再试');
    }
    const now = Date.now();
    const request = {
      action,
      repo: this.repo,
      mirror: this.mirror,
      requestedAt: now,
    };
    writeJsonAtomic(this.requestPath, request);
    return { queued: true, action, requestedAt: now };
  }
}
