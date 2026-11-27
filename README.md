# 示范

移民咨询的客户问卷系统：客户在前台像聊天一样逐题作答，管理员在控制台查看、导出填写记录，并管理题库。

## 组成

| 位置 | 作用 |
|---|---|
| `dist/` | 前台问答页（`index.html`、`app.js`、`style.css`） |
| `dist/admin/` | 控制台页面，地址是 `/admin/` |
| `functions/api/` | 后端接口，运行在 Cloudflare Pages Functions |
| `server/lib.js` | 后端接口共用的代码：数据库访问、登录校验、问卷校验、CSV |
| `supabase/schema.sql` | 数据库结构，在 Supabase 的 SQL Editor 里运行一次 |

浏览器不直接访问数据库。所有读写都经过后端接口，数据库的管理密钥只放在服务端的环境变量里。

## 环境变量

| 名称 | 内容 |
|---|---|
| `SUPABASE_URL` | Supabase 项目地址 |
| `SUPABASE_SERVICE_ROLE_KEY` | 管理密钥（`sb_secret_` 开头，或旧版 `service_role`）。不要写进代码或发给别人 |
| `ADMIN_EMAILS` | 允许登录控制台的邮箱，多个用英文逗号隔开 |

本地运行：把 `.dev.vars.example` 复制为 `.dev.vars` 并填入真实的值。这个文件不会被提交。
线上：在 Cloudflare Pages 项目的 Settings → Variables and Secrets 里填同样三项。

## 本地运行

```sh
npx wrangler@4 pages dev dist --port 8788 --compatibility-date 2026-01-01
```

打开 http://localhost:8788 是前台，http://localhost:8788/admin/ 是控制台。

## 部署到 Cloudflare Pages

1. 在 Cloudflare 新建 Pages 项目并连接这个 GitHub 仓库。
2. 构建命令留空，输出目录填 `dist`。
3. 填入上面三个环境变量，其中密钥选择“加密”。
4. 在 Supabase 的 Authentication → Users 里创建管理员账号，邮箱要与 `ADMIN_EMAILS` 一致。

## 管理员账号

控制台用 Supabase 自带的邮箱加密码登录。只有邮箱在 `ADMIN_EMAILS` 里、并且已验证的账号才能进入。
建议在 Supabase 的 Authentication 设置里关闭公开注册。

## 还没做的

- 提交接口的人机验证（Cloudflare Turnstile）和频率限制
- 修改题目的草稿与预览（现在保存后立即生效）
- 提交后的通知邮件
- 隐私说明的正式文案，需由持牌律师确认
