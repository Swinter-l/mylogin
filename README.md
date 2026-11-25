# 账号中心 · 登录注册系统

一个带后端和 MySQL 持久化的登录注册网站。注册信息实时写入 MySQL 的 `usedatas.users` 表，密码使用 bcrypt 加盐哈希存储。

> **重要**：本项目包含 Node.js 后端并连接 MySQL 数据库，**不能**部署到 GitHub Pages（Pages 只托管静态文件，无法运行后端，也无法连接你的本地数据库）。GitHub 仓库用于**代码托管/版本管理**。要在线运行，请在本机或你自己的服务器上启动后端。

## 功能

- 登录 / 注册页面，支持"没有账号？立即注册"切换
- 注册信息实时写入 MySQL
- bcrypt 密码哈希、参数化查询、登录失败限流、签名 Cookie 会话
- 表单校验与错误提示
- 启动后自动建表（`usedatas.users`）

## 本地运行

1. 安装依赖：

   ```bash
   npm install
   ```

2. 配置数据库：复制 `.env.example` 为 `.env`，填入你的 MySQL 连接信息。

   ```bash
   cp .env.example .env
   ```

3. 启动服务：

   ```bash
   npm start
   ```

4. 浏览器访问 `http://localhost:3000`。

## 数据库表结构

服务首次启动会自动在 `usedatas` 库中创建 `users` 表（若不存在）：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键，自增 |
| `username` | 用户名，唯一 |
| `email` | 邮箱，唯一 |
| `password_hash` | bcrypt 哈希后的密码 |
| `display_name` | 显示名 |
| `status` | 账号状态 |
| `last_login_at` | 最后登录时间 |
| `created_at` / `updated_at` | 创建/更新时间 |

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查（含数据库连接状态） |
| `POST` | `/api/register` | 注册 |
| `POST` | `/api/login` | 登录 |
| `GET` | `/api/me` | 获取当前登录用户 |
| `POST` | `/api/logout` | 退出登录 |

## 安全提醒

- `.env` 含数据库密码，已被 `.gitignore` 忽略，**不要提交或上传到公开仓库**。
- 不要将 MySQL 的 root 账号暴露到公网。如需远程访问数据库，请创建最小权限的专用账号并限制来源 IP。
