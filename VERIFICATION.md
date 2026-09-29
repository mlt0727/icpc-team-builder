# 交付与验证状态

验证日期：2026-09-29。需求以“无需选择身份，任何人可拖动任意学生，并记录离队/换队”为准。

## 已完成

- 学生页无身份弹窗；任何学生卡片都可拖动。手机/键盘可用上方 Student 与 Move to 菜单替代拖拽。
- 活动独立网址、密码管理入口、新建活动、批量添加学生、关闭/重新开放活动。
- 离队/换队日志包含学生姓名快照、原队伍、去向、时间、匿名操作浏览器 UUID。管理页按活动读取，支持向前翻页；普通访客无日志读写权限。
- Supabase 两个迁移已在当前项目执行；匿名登录和 Realtime 已启用。
- `.env.local` 的公开连接信息已经配置；管理密码使用用户指定的值，会话密钥已生成。Vercel Production 已配置这四项变量。该文件不会进入 Git 或源码 ZIP。
- 管理页显示“密码提示：生日”，其他界面文案为英文。选中活动后的日志每 5 秒自动刷新，隐藏标签页暂停，回到页面或网络恢复时补读。

## 实际通过的检查

- ESLint、TypeScript、5 项单元测试、Next.js 生产构建。
- 本地真实 PostgreSQL 回归测试全部通过（11 个子测试及其父测试）：20 人并发抢位最多 3 人、任意浏览器移动、多活动隔离、重复迁移不重置状态、日志内容、日志写入失败时移动回滚、权限拒绝、原子添加、共享登录限流。
- 云端独立测试活动：全新浏览器无身份弹窗；同一浏览器拖动两名不同学生；另一浏览器无需刷新即可收到变化。
- Supabase 实际审计表确认：QA Alpha 从 Team 4 到 Team 2；QA Bravo 从 Team 1 到 Unassigned；两条记录均含同一实际操作浏览器 UUID 和服务器时间。
- QA Bravo 随后从 Unassigned 加入 Team 2，日志总数仍为 2；首次入队不误记为离队。
- 公开 Supabase 客户端无法读取日志；未登录调用管理日志 API 返回 401。
- 390px 宽度下无横向溢出，20 个拖拽按钮可用且无身份弹窗。真实手机触控未实机验证。
- 生产浏览器未捕获 JavaScript 错误。正式 20 人没有用于自动化分队测试。

## 尚待配置

`SUPABASE_SECRET_KEY` 仍为空。请自行将 Supabase API Keys 页的 `sb_secret_…` 填入 Vercel 项目的 Production 环境变量，然后重新部署；本地运行则填入 `.env.local` 后重启服务。它与自选管理密码是两个不同的值。

管理页代码、日志 API、权限及数据库逻辑已完成；因为尚缺服务端密钥，尚未完成真实管理密码登录 → 浏览器新建活动 → 管理页查看日志的完整链路验证。学生页和数据库自动记录当前已工作。

## 正式部署

- 初次手动部署验证：Vercel Production **READY**，部署 ID `dpl_34fpa12KZZA7w8zuyEeUMhFHjKc8`。后续版本由已连接的 GitHub `main` 分支自动部署；当前部署状态以 Vercel 为准。
- 最新修复验证：从姓名卡片右侧空白处开始拖动，成功出现拖拽浮层；取消后未改变正式分组。右上角锁图标点击后进入 `/admin`，密码框可输入，Sign in 可点击；缺少服务端数据库密钥时返回明确配置提示，不授予管理会话。
- 学生页：https://icpc-team-builder-six.vercel.app/e/icpc-2026
- 管理页：https://icpc-team-builder-six.vercel.app/admin
- 环境变量设置：https://vercel.com/lingtong-mengs-projects/icpc-team-builder/settings/environment-variables
- 云端构建成功；公开访问学生页与管理页均返回 HTTP 200。真实浏览器加载 20 人、7 队、Live 状态，管理页中文提示正确；未登录日志 API 返回 401。
- 部署后浏览器和 Vercel 最近一小时运行错误检查均未发现错误。日志后台的完整登录验证仍待 Supabase Secret key；尚未配置外部日志接收服务。
- 源码已推送到私有仓库 https://github.com/mlt0727/icpc-team-builder ，现有 Vercel 项目已连接该仓库，正式分支为 `main`。本地 `origin` 和远程跟踪已设置。提交前已检查 `.env.local`、`.vercel` 及真实密码/密钥均未进入提交。
- ZIP 不包含环境配置、构建产物或依赖目录；完整部署步骤见 README。

## 保留的测试证据

云端有一场独立活动 `qa-browser-20260929`，名称为 **Verification only (closed)**，包含 4 名 QA 测试学生和 2 条撤出记录。已关闭，保留供配置好管理页后核对；与正式 `icpc-2026` 名单完全独立。
