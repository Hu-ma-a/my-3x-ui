#!/usr/bin/env node
/**
 * 门户更新执行器（由 systemd timer 以 root 运行）。
 * 读取 data/update/request.json：check 检查最新版本，apply 下载并调用 install.sh --upgrade。
 * 结果写入 data/update/result.json，供管理后台轮询展示。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.PORTAL_HOME || '/opt/portal';
const DATA_DIR = process.env.PORTAL_DATA_DIR || path.join(HOME, 'data');
const ENV_FILE = process.env.PORTAL_ENV_FILE || '/etc/portal/portal.env';
const UPDATE_DIR = path.join(DATA_DIR, 'update');
const REQUEST_FILE = path.join(UPDATE_DIR, 'request.json');
const RESULT_FILE = path.join(UPDATE_DIR, 'result.json');
const BACKUP_DIR = process.env.PORTAL_BACKUP_DIR || '/var/backups/portal';
const PROGRAM_BACKUP = path.join(BACKUP_DIR, 'portal-program-last.tar.gz');
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MIRROR_PATTERN = /^https?:\/\/[^\s]+$/i;

function log(message) {
  console.log(`[portal-update] ${message}`);
}

function readJson(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function dataDirOwner() {
  try {
    return statSync(DATA_DIR);
  } catch {
    return null;
  }
}

function shareWithPortal(target) {
  const owner = dataDirOwner();
  if (!owner) return;
  try {
    chownSync(target, owner.uid, owner.gid);
    chmodSync(target, 0o640);
  } catch {
    // 权限修复失败不应中断更新流程。
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const owner = dataDirOwner();
  if (owner) {
    try {
      chownSync(dir, owner.uid, owner.gid);
      chmodSync(dir, 0o750);
    } catch {
      // 目录权限修复失败时继续写文件。
    }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  shareWithPortal(file);
}

function writeHeartbeat(action = 'idle') {
  try {
    writeJsonAtomic(path.join(UPDATE_DIR, 'heartbeat.json'), { at: Date.now(), action });
  } catch {
    // 心跳失败不应影响更新主流程。
  }
}

function writeResult(result) {
  const payload = { ...result, at: Date.now() };
  writeJsonAtomic(RESULT_FILE, payload);
  try {
    rmSync(REQUEST_FILE, { force: true });
  } catch {
    // 请求文件不存在时忽略。
  }
  log(`结果：${payload.status}${payload.message ? `（${payload.message}）` : ''}`);
}

function envValue(key) {
  if (process.env[key]) return String(process.env[key]);
  try {
    const content = readFileSync(ENV_FILE, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
  } catch {
    return '';
  }
}

function mirrorUrl(url, mirror) {
  if (!mirror) return url;
  return `${mirror.replace(/\/+$/, '')}/${url}`;
}

function currentVersion() {
  try {
    return readFileSync(path.join(HOME, 'VERSION'), 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}

function versionOf(tag) {
  return String(tag || '').replace(/^portal-v/i, '').replace(/^v/i, '');
}

function isNewer(candidate, current) {
  const parse = (value) => {
    const match = String(value || '').match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const left = parse(candidate);
  const right = parse(current);
  if (!left || !right) return Boolean(candidate);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

async function latestReleaseTag(repo, mirror) {
  const url = mirrorUrl(`https://github.com/${repo}/releases/latest`, mirror);
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'portal-updater' },
    signal: AbortSignal.timeout(30000),
  });
  const location = response.headers.get('location') || '';
  const byTag = location.match(/\/tag\/([^/?#]+)/);
  if (byTag) return decodeURIComponent(byTag[1]);
  const byTail = location.match(/\/(portal-v[\w.-]+)$/);
  if (byTail) return byTail[1];
  if (response.status === 200) {
    const body = await response.text();
    const tag = body.match(/\/releases\/tag\/([^"?#]+)/);
    if (tag) return decodeURIComponent(tag[1]);
  }
  throw new Error(`无法获取最新版本（HTTP ${response.status}）`);
}

async function downloadAsset(repo, tag, mirror, destDir) {
  const assetUrl = mirrorUrl(
    `https://github.com/${repo}/releases/download/${tag}/portal.tar.gz`,
    mirror,
  );
  log(`下载 ${assetUrl}`);
  const response = await fetch(assetUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'portal-updater' },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`下载更新包失败（HTTP ${response.status}）`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4096) throw new Error('更新包内容异常（文件过小）');

  try {
    const sumUrl = `${assetUrl}.sha256`;
    const sumResponse = await fetch(sumUrl, { signal: AbortSignal.timeout(30000) });
    if (sumResponse.ok) {
      const expected = (await sumResponse.text()).trim().split(/\s+/)[0].toLowerCase();
      const actual = createHash('sha256').update(buffer).digest('hex');
      if (expected && expected !== actual) throw new Error('更新包校验失败（sha256 不匹配）');
      log('sha256 校验通过');
    }
  } catch (err) {
    if (String(err.message || '').includes('校验失败')) throw err;
    log('未找到校验文件，跳过 sha256 校验');
  }

  const archive = path.join(destDir, 'portal.tar.gz');
  writeFileSync(archive, buffer, { mode: 0o600 });
  const extractDir = path.join(destDir, 'src');
  mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', extractDir], { stdio: 'inherit' });
  const installScript = path.join(extractDir, 'portal', 'scripts', 'install.sh');
  if (!existsSync(installScript)) throw new Error('更新包结构异常：缺少 portal/scripts/install.sh');
  return installScript;
}

async function runApply(repo, mirror) {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('更新执行器需要 root 权限，请确认 portal-update.timer 以 root 运行');
  }
  const tag = await latestReleaseTag(repo, mirror);
  if (!tag) throw new Error('未能解析最新版本标签');
  const current = currentVersion();
  if (!isNewer(versionOf(tag), current)) {
    writeResult({ status: 'checked', latestTag: tag, currentVersion: current, message: '当前已是最新版本' });
    return;
  }

  const workDir = mkdtempSync(path.join(os.tmpdir(), 'portal-update-'));
  try {
    log(`开始更新：${current} → ${versionOf(tag)}（${tag}）`);
    const installScript = await downloadAsset(repo, tag, mirror, workDir);
    const previousEnv = process.env.PORTAL_ENV_FILE;
    process.env.PORTAL_ENV_FILE = ENV_FILE;
    process.env.PORTAL_REPO = repo;
    process.env.PORTAL_GH_MIRROR = mirror;

    // 升级前备份当前程序文件（不含 data），新版本启动失败时自动回滚。
    try {
      backupProgram();
      log(`已备份当前程序文件到 ${PROGRAM_BACKUP}`);
    } catch (err) {
      throw new Error(`升级前备份失败，未执行升级：${err.message}`);
    }

    log('调用 install.sh --upgrade 部署新版本…');
    writeHeartbeat('applying');
    try {
      execFileSync('bash', [installScript, '--upgrade', '--no-auto'], {
        stdio: 'inherit',
        env: { ...process.env, PORTAL_UPDATE_SELF: '1' },
      });
    } catch (err) {
      await rollbackUpdate(tag, new Error(`install.sh 执行失败：${err.message}`));
      return;
    }
    if (!(await waitHealth(90000))) {
      await rollbackUpdate(tag, new Error('新版本启动后健康检查未通过'));
      return;
    }
    if (previousEnv === undefined) delete process.env.PORTAL_ENV_FILE;
    else process.env.PORTAL_ENV_FILE = previousEnv;
    writeResult({ status: 'applied', latestTag: tag, currentVersion: versionOf(tag), message: `已更新到 ${tag}` });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function healthPort() {
  const fromEnv = Number(envValue('PORTAL_PORT'));
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : Number(process.env.PORTAL_PORT || 8090);
}

async function waitHealth(timeoutMs = 90000) {
  const port = healthPort();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return true;
    } catch {
      // 服务重启期间连接失败，继续等待。
    }
    await sleep(1000);
  }
  return false;
}

function backupProgram() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  rmSync(PROGRAM_BACKUP, { force: true });
  execFileSync(
    'tar',
    [
      '-czf',
      PROGRAM_BACKUP,
      '--exclude=portal/data',
      '--exclude=portal/data/*',
      '-C',
      path.dirname(HOME),
      path.basename(HOME),
    ],
    { stdio: 'inherit', env: process.env },
  );
}

function restoreProgram() {
  execFileSync('systemctl', ['stop', 'portal'], { stdio: 'inherit' });
  execFileSync('tar', ['-xzf', PROGRAM_BACKUP, '-C', path.dirname(HOME)], { stdio: 'inherit' });
  try {
    execFileSync('chown', ['-R', 'portal:portal', HOME], { stdio: 'ignore' });
  } catch {
    // 用户/组不存在时保持原权限。
  }
  execFileSync('systemctl', ['start', 'portal'], { stdio: 'inherit' });
}

async function rollbackUpdate(tag, cause) {
  const message = cause && cause.message ? cause.message : String(cause);
  log(`升级失败：${message}，开始自动回滚…`);
  writeHeartbeat('rolling-back');
  try {
    restoreProgram();
    if (!(await waitHealth(60000))) throw new Error('回滚后健康检查未通过');
    writeResult({
      status: 'failed',
      latestTag: tag,
      currentVersion: currentVersion(),
      message: `升级失败：${message}；已自动回滚到上一版本`,
    });
  } catch (err) {
    writeResult({
      status: 'failed',
      latestTag: tag,
      message: `升级失败：${message}；自动回滚也失败：${err.message}。请在服务器执行 sudo bash ${path.join(HOME, 'scripts', 'install.sh')} --upgrade 修复`,
    });
  }
}

async function main() {
  const request = readJson(REQUEST_FILE);
  writeHeartbeat(request ? String(request.action || '') : 'idle');
  if (!request) {
    log('没有待处理的更新请求，退出');
    return;
  }
  const action = String(request.action || '');
  const repo = String(request.repo || envValue('PORTAL_UPDATE_REPO') || '').trim();
  const mirror = String(request.mirror || envValue('PORTAL_UPDATE_MIRROR') || '').trim();
  if (!REPO_PATTERN.test(repo)) {
    writeResult({ status: 'failed', message: '未配置有效的更新仓库（PORTAL_UPDATE_REPO）' });
    return;
  }
  if (mirror && !MIRROR_PATTERN.test(mirror)) {
    writeResult({ status: 'failed', message: 'PORTAL_UPDATE_MIRROR 必须是以 http:// 或 https:// 开头的地址' });
    return;
  }
  try {
    if (action === 'check') {
      const tag = await latestReleaseTag(repo, mirror);
      if (!tag) throw new Error('未能解析最新版本标签');
      writeResult({
        status: 'checked',
        latestTag: tag,
        currentVersion: currentVersion(),
        releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
        checkedAt: Date.now(),
      });
      return;
    }
    if (action === 'apply') {
      await runApply(repo, mirror);
      return;
    }
    writeResult({ status: 'failed', message: `未知操作：${action}` });
  } catch (err) {
    writeResult({ status: 'failed', message: err && err.message ? err.message : String(err) });
  }
}

main().catch((err) => {
  writeResult({ status: 'failed', message: err && err.message ? err.message : String(err) });
  process.exitCode = 1;
});
