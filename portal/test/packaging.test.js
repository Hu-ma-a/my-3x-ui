import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const PORTAL = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(PORTAL, '..');

function read(relative) {
  return fs.readFileSync(path.join(PORTAL, relative), 'utf8');
}

describe('一键安装与发布产物', () => {
  it('install.sh 存在、LF 换行且支持关键参数', () => {
    const script = read('scripts/install.sh');
    assert.ok(script.startsWith('#!/usr/bin/env bash'), 'install.sh 必须有 bash shebang');
    assert.ok(script.includes('set -euo pipefail'), 'install.sh 应启用严格模式');
    assert.ok(!script.includes('\r'), 'install.sh 必须使用 LF 换行（否则在 Linux 上会报错）');
    for (const flag of ['--repo', '--ref', '--upgrade', '--docker', '--dry-run', '--help', '--xui-token', '--xui-user', '--xui-pass', '--admin-pass', '--uninstall', '--auto', '--no-auto', '--watch']) {
      assert.ok(script.includes(flag), `install.sh 缺少参数 ${flag}`);
    }
    assert.ok(script.includes('curl -fsSL') && script.includes('portal.tar.gz'), 'install.sh 应支持从 GitHub Release 下载源码');
    assert.ok(script.includes('systemctl') && script.includes('docker run'), 'install.sh 应同时支持 systemd 与 Docker');
    assert.ok(script.includes('getApiToken') && script.includes('tokenName portal'), '零配置模式应自动创建专用 API Token');
  });

  it('跟随自检脚本存在且能同步端口/Token', () => {
    const syncPath = path.join(PORTAL, 'scripts/xui-sync.sh');
    assert.ok(fs.existsSync(syncPath), '缺少 scripts/xui-sync.sh');
    const sync = fs.readFileSync(syncPath, 'utf8');
    assert.ok(sync.startsWith('#!/usr/bin/env bash'), 'xui-sync.sh 需要 bash shebang');
    assert.ok(sync.includes('XUI_BASE_PATH') && sync.includes('XUI_API_TOKEN'), '自检脚本应同步 basePath 与 Token');
    assert.ok(sync.includes('systemctl restart'), '自检脚本应能在配置变化后重启门户');
    assert.ok(!sync.includes('\r'), 'xui-sync.sh 必须使用 LF 换行');
  });

  it('docker-compose.yml 使用持久化数据卷并在容器内使用 /data', () => {
    const compose = read('docker-compose.yml');
    assert.match(compose, /portal-data:\/data/, '数据必须落到命名卷 portal-data');
    assert.match(compose, /PORTAL_DATA_DIR: \/data/, '容器内数据目录应为 /data');
    assert.match(compose, /PORTAL_DB_PATH: \/data\/portal\.db/, '容器内数据库路径应为 /data/portal.db');
    assert.match(compose, /env_file:/, 'compose 应通过 env_file 读取配置');
    assert.match(compose, /healthcheck:/, 'compose 应包含健康检查');
  });

  it('GitHub Actions 发布会同时产出 Release 包与 GHCR 镜像', () => {
    const workflowPath = path.join(REPO, '.github/workflows/portal-release.yml');
    assert.ok(fs.existsSync(workflowPath), '缺少 .github/workflows/portal-release.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    assert.ok(workflow.includes('portal-v*'), 'workflow 应支持 portal-v* 标签发布');
    assert.ok(workflow.includes('portal.tar.gz'), 'workflow 应生成 portal.tar.gz 供一键脚本下载');
    assert.ok(workflow.includes('ghcr.io'), 'workflow 应推送 GHCR 镜像');
    assert.ok(workflow.includes('packages: write') && workflow.includes('contents: write'), 'workflow 需要 Release 与 Packages 写权限');
    assert.ok(workflow.includes('context: ./portal'), '镜像构建上下文应为 portal/');
  });

  it('README 与部署文档给出一键安装入口', () => {
    const readme = read('README.md');
    assert.ok(readme.includes('## 懒人安装'), 'README 缺少「懒人安装」章节');
    assert.ok(readme.includes('scripts/install.sh'), 'README 应引用一键安装脚本');
    assert.ok(readme.includes('docker compose up -d --build'), 'README 应给出一条 Docker Compose 命令');
    assert.ok(readme.includes('portal-release'), 'README 应说明 GitHub 发布流程');
    const deploy = read('docs/DEPLOY.md');
    assert.ok(deploy.includes('## 12. 一键安装与升级'), 'DEPLOY 缺少一键安装章节');
  });

  it('后台一键更新：执行器、版本号与校验文件齐备', () => {
    const runner = fs.readFileSync(path.join(PORTAL, 'scripts/update-runner.mjs'), 'utf8');
    assert.ok(runner.startsWith('#!/usr/bin/env node'), 'update-runner.mjs 需要 node shebang');
    assert.ok(runner.includes("action === 'check'") && runner.includes("action === 'apply'"), '更新执行器需支持检查与更新');
    assert.ok(runner.includes("'--upgrade'"), '更新执行器应调用 install.sh --upgrade');
    assert.ok(runner.includes('sha256'), '更新执行器应支持 sha256 校验');

    const script = read('scripts/install.sh');
    assert.ok(script.includes('--check-update'), 'install.sh 应提供 --check-update 检查命令');
    assert.ok(script.includes('portal-update.timer'), 'install.sh 应安装后台更新 timer');
    assert.ok(script.includes('PORTAL_UPDATE_REPO'), 'install.sh 应写入更新源仓库');

    const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/portal-release.yml'), 'utf8');
    assert.ok(workflow.includes('portal/VERSION'), '发布包需要写入版本号文件');
    assert.ok(workflow.includes('portal.tar.gz.sha256'), '发布包需要附带 sha256 校验文件');
  });

  it('更新执行器写出的心跳/结果对 portal 用户可读', () => {
    const runner = fs.readFileSync(path.join(PORTAL, 'scripts/update-runner.mjs'), 'utf8');
    assert.ok(runner.includes('chownSync') && runner.includes('chmodSync'), '更新执行器需要把结果文件归属改为 portal 用户');
    assert.ok(runner.includes('shareWithPortal'), '更新执行器应修复心跳/结果文件权限');

    const script = read('scripts/install.sh');
    assert.ok(script.includes('data/update'), 'install.sh 应修复 data/update 目录权限');
  });

  it('SSH 命令行工具：安装 portal 命令并可重置密码', () => {
    const cli = fs.readFileSync(path.join(PORTAL, 'scripts/portal-cli.mjs'), 'utf8');
    assert.ok(cli.startsWith('#!/usr/bin/env node'), 'portal-cli.mjs 需要 node shebang');
    assert.ok(cli.includes("'set-password'"), '命令行工具应支持 set-password');
    assert.ok(cli.includes('list-admins'), '命令行工具应支持 list-admins');

    const script = read('scripts/install.sh');
    assert.ok(script.includes('/usr/local/bin/portal'), 'install.sh 应安装 portal 命令');
    assert.ok(script.includes('portal-cli.mjs'), 'portal 命令应调用 portal-cli.mjs');

    const readme = read('README.md');
    assert.ok(readme.includes('portal set-password'), 'README 应说明 portal set-password 用法');
  });
});
