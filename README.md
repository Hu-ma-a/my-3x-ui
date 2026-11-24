# 用户门户（portal）

面向终端用户的自助服务门户：注册 / 登录、套餐购买、在线充值、查看流量与订阅链接；管理员可管理用户（封禁 / 解封）、管理员账号、套餐、订单与支付配置，并支持后台检查更新与一键更新。

门户通过面板的 REST API 管理节点与客户端，不修改面板源码；可独立部署在已有面板旁边。

## 快速开始

```bash
# 一键安装（Linux / systemd，与面板同机时零配置）
sudo bash portal/scripts/install.sh

# 或 Docker
cd portal && cp .env.example .env && docker compose up -d --build
```

- 功能与配置说明：[portal/README.md](portal/README.md)
- 部署、升级与排障：[portal/docs/DEPLOY.md](portal/docs/DEPLOY.md)
- 发布：推送 tag `portal-v1.0.0`，GitHub Actions 产出 `portal.tar.gz` 与 GHCR 镜像（[.github/workflows/portal-release.yml](.github/workflows/portal-release.yml)）。

## 目录结构

```
portal/                       用户门户（Node.js 后端 + 零构建前端 + 安装/更新脚本）
.github/workflows/            发布工作流（Release 包 + Docker 镜像）
LICENSE                       GPLv3
```
