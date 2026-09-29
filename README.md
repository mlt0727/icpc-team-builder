# ICPC Team Builder

一个可重复使用的 ICPC 分队工具。Next.js + TypeScript + Tailwind CSS + dnd-kit；Supabase PostgreSQL、Anonymous Auth 和 Realtime；部署到 Vercel。

当前项目：[GitHub 私有仓库](https://github.com/mlt0727/icpc-team-builder) · [正式学生页](https://icpc-team-builder-six.vercel.app/e/icpc-2026) · [管理页](https://icpc-team-builder-six.vercel.app/admin)。Vercel 已连接此仓库，`main` 为正式部署分支；后续推送由 Git 集成自动部署。环境变量在 Vercel 项目设置中管理，不提交到仓库。

## 两类网址

| 用途 | 路径 |
| --- | --- |
| 第一场活动，已预置指定的 20 人、7 队 | `/e/icpc-2026` |
| 后续活动，例如春季训练 | `/e/icpc-spring-2027` |
| 隐藏的密码管理入口 | `/admin` |

学生页面右上角的小锁图标通往密码管理入口，不显示醒目的管理按钮。页面不询问身份，任何人都能从姓名卡片任意位置拖动任意学生，帮队友入队；手机长按卡片拖动。管理页可创建活动、批量添加学生、复制链接、关闭/重新开放活动，并查看离队/换队记录。每次创建活动都生成独立名单和独立链接，旧活动不会被覆盖；每队始终最多 3 人。网站根路径 `/` 自动跳转第一场活动。

## 1. 创建和初始化 Supabase

1. 在 Supabase 创建项目，数据库密码自己保管。GitHub 集成可跳过。
2. 保留 **Enable Data API**；可以关闭自动暴露新表，SQL 会显式授权。
3. 在项目 **SQL Editor → New query** 中按顺序运行以下两个完整文件：
   - [`202609290001_team_builder.sql`](supabase/migrations/202609290001_team_builder.sql)：基础表、20 人名单、原子分队 RPC。
   - [`202609290002_open_moves_and_history.sql`](supabase/migrations/202609290002_open_moves_and_history.sql)：自由拖拽、离队记录、关闭旧的姓名认领接口。
   如果已经运行过第一个文件，只需运行第二个。以后重跑初始化时仍按此顺序。
4. 在 **Authentication → Sign In / Providers** 开启 **Allow anonymous sign-ins** 并保存。
5. SQL 已把 `public.participants` 和 `public.events` 加入 `supabase_realtime` publication。可以在 Database → Publications 验证两张表已启用。无需轮询。

SQL 会创建表、RLS、原子 RPC 并导入全部 20 个指定姓名。可重复执行，**不会重置已有队伍或记录**。在 SQL Editor 执行时，`DROP POLICY/TRIGGER IF EXISTS` 可能触发通用警告；它们用于重建本应用的访问策略和版本触发器，不删除学生记录。请使用本应用独立的 Supabase 项目。

## 2. 配置环境变量

复制 `.env.example` 为 `.env.local`，填写：

| 变量 | 来源 / 用途 | 可以进入浏览器？ |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 项目 Connect 对话框的 Project URL | 是 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` 公共客户端密钥 | 是 |
| `SUPABASE_SECRET_KEY` | Settings → API Keys 中 `sb_secret_…` 服务端密钥，兼容旧版 `service_role` JWT；不能用公开 key、数据库密码或管理密码 | **否** |
| `ADMIN_PASSWORD` | 自选管理密码，至少 8 字符，最多 256 字符 | **否** |
| `ADMIN_SESSION_SECRET` | 随机会话签名密钥，至少 32 字符 | **否** |

生成随机会话密钥：

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

数据库密码与管理页面密码是两个独立的密码。网站运行不需要数据库密码。

`.env.local` 已被 `.gitignore` 排除；不要上传它，也不要把任何服务端变量改成 `NEXT_PUBLIC_` 前缀。代码和交付 ZIP 不包含真实配置。未配置 Supabase 时明确显示 Setup needed，不会显示假名单。仅缺服务端配置时，学生页面仍能工作，管理页会提示配置未完成。

## 3. 本地运行

使用 Node.js **24 LTS**（至少 22.18）：

```sh
npm install
npm run dev
```

访问 `http://localhost:3000/e/icpc-2026`；管理员访问 `http://localhost:3000/admin`。

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

环境变量修改后重启开发服务。`NEXT_PUBLIC_` 值在生产构建时写入前端，部署后修改它们需要重新构建。

## 4. GitHub 与 Vercel 部署

1. 将本目录作为独立 GitHub 仓库上传，包含 `package-lock.json` 和 SQL，排除 `.env.local`、`node_modules`、`.next`。
2. 在 Vercel 选择 **Add New → Project**，导入此 GitHub 仓库。框架选择 Next.js；如果仓库根目录就是本目录，Root Directory 保持默认。
3. Node.js 选择 24.x；Build Command 使用 `npm run build`，其他构建设置保持框架默认。
4. 在 Vercel 的 Environment Variables 添加上表 **全部 5 个变量**。服务端三个值仅供服务器使用。Production 环境必填；Preview 环境可用独立 Supabase 项目，避免测试影响正式名单。
5. 点击 Deploy。以后 GitHub 的代码更新可触发 Vercel 自动部署；新 SQL 迁移需要在 Supabase 执行。
6. 在 Supabase 的 Authentication → URL Configuration 中将 Site URL 设置为生产网址。此应用不使用邮件或 OAuth 回调。
7. 打开 `https://你的域名/admin`，用 `ADMIN_PASSWORD` 登录。把每场活动的 `/e/活动标识` 链接发给学生。

**Supabase 不需要连接 GitHub 仓库才能工作。** 网站部署在 Vercel，通过环境变量连接 Supabase。只有初次建库或升级数据库结构需要执行 SQL；以后新增活动、添加学生直接在管理页完成。

## 日常使用

- **新活动**：进入 `/admin` → 填活动名称、唯一网址标识、队伍数量、学生姓名（每行一个）→ Create event → Copy link。
- **补充学生**：选择已有活动 → Add students。重复姓名会拒绝，整批操作失败时不留下半批数据。同名学生需加区分标记。
- **保存最终分组**：Close event。学生仍可查看，但不能换队；Reopen event 恢复操作。旧活动始终保留，不自动清空。
- **检查异常移出**：选中活动，查看 **Departures & team changes**。记录包括被移动的姓名、原队伍、去向、时间和操作浏览器匿名编号；管理页可见时每 5 秒自动更新，也可点 Refresh，Load older records 查看更早记录。管理界面不能编辑或删除记录。
- **变更管理员密码**：修改服务器/Vercel 的 `ADMIN_PASSWORD` 后重新部署。已有管理会话立即失效；学生身份和分组不受影响。

## 数据与权限

- `events` 隔离活动，`teams` 提供每场活动的队伍行锁，`participants` 保存学生和分组。历史版本的 `claimed_by` 列保留以安全升级，但不再参与访问控制。
- 打开页面不询问姓名。首次移动时静默建立 Supabase 匿名会话，用于记录操作浏览器；任何匿名用户都可移动活动里的任意学生。
- 所有访客可读取公共分组数据；直接插入、修改、删除表全部被撤销授权。学生只能执行移动 RPC，不能查看、插入、修改或删除日志。
- RPC 从 `auth.uid()` 识别操作浏览器，锁定学生，再锁定目标队伍、检查容量并更新，所有步骤在同一事务完成。
- 每队只有 `team_slot = 1,2,3`，且 `(event_id, team_number, team_slot)` 唯一。这一数据库约束进一步保证不能出现第 4 人，即使客户端被篡改。
- Realtime 订阅按活动过滤。重新连接、网络恢复或重新显示页面时重读快照；`version` 防止旧响应覆盖新状态。无定时轮询，拖动成功前不假装已保存。
- 管理 RPC 仅允许 `service_role`，由验证管理会话后的服务器使用 Secret key 调用。8 小时 HttpOnly/SameSite cookie、HMAC 签名、同源写请求验证；管理登录按来源在数据库中限流（每 15 分钟 10 次），多实例共享。
- `team_departures` 由数据库触发器追加记录：原队伍非空且发生变化时记录，涵盖队伍 → 另一个队伍及队伍 → Unassigned。首次入队、原地不动、被拒绝的操作不记为离队。日志与移动同事务提交；日志写入失败时移动也回滚。
- 日志仅管理员可读，不加入公共 Realtime publication。保存姓名快照和操作 UUID；正常界面无清空记录入口。数据库所有者仍有数据库级管理权限。
- 学生名单和分组是公共可读数据；活动 URL 不提供保密访问。`/admin` 的安全来自服务端密码验证，隐藏链接只是界面安排。
- 匿名编号不能证明现实中是谁操作；清除浏览数据或换设备会生成不同编号，不采集 IP 地址。学生无需重新认领任何姓名。参见 [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)。

## 数据库回归测试

`npm test` 验证管理会话签名/篡改/过期、密码比较、旧快照合并、排序和错误脱敏。

`npm run test:db` 使用真实 PostgreSQL 的独立连接，覆盖 20 人同时抢 3 个席位、任意浏览器帮人换队、离队日志内容、日志失败时事务回滚、RLS、日志读取/删除限制、跨活动隔离、SQL 重跑持久性、原子添加、管理登录限流。需要本地临时 PostgreSQL：

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:本地测试密码@127.0.0.1:5432/postgres'
npm run test:db
```

测试只接受 loopback 地址，自动创建并删除随机 `icpc_test_…` 数据库；不修改连接 URL 指向的业务数据库。不需要在 Supabase 生产库里创建假学生。独立数据库中的 `auth.uid()` 使用测试桩，线上 JWT 验证由 Supabase Auth 执行。

## 上线验收

用管理页建一场独立测试活动；在两个不同浏览器直接移动同一名测试学生，验证无身份弹窗、拖拽/触屏、实时更新、刷新后分组保留、满队拒绝、关闭活动后的只读状态，再到管理页核对离队/换队记录。正式 20 人保持初始未分队，直到学生自己使用。

排错：无法读表时检查 SQL 是否执行、Data API 是否开启及 Project URL/key；不能移动时检查 Anonymous Sign-Ins；不显示 Live 时检查两张表的 Realtime publication 与网络；管理员不能登录时检查服务端三个环境变量及 `check_admin_login_limit` RPC；日志查询失败时检查第二个迁移是否执行。不要把原始数据库错误或密钥贴给学生。

官方参考：[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) · [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
