# Cloudflare R2 OSS 管理面板

基于 Cloudflare Pages Functions + R2 的轻量文件管理系统。

## 当前功能
- 目录浏览、搜索、排序
- 文件上传（含大文件分片上传）
- 图片/视频缩略图
- 文件预览：图片、视频、音频、PDF、文本、JSON、Markdown
- 批量操作：多选、批量复制、批量移动、批量删除
- 基于目录前缀的写权限控制（多管理员）
- 用量统计卡片（总占用、配额占比、本周期新增上传）

## 部署方式（Cloudflare Pages 自动部署）
1. 将本仓库连接到 Cloudflare Pages（Production 分支建议用 `main`）。
2. 在 Cloudflare R2 创建桶。
3. 在 Pages 项目中绑定 R2：
   - `Settings` -> `Functions` -> `R2 bucket bindings`
   - 变量名填写 `BUCKET`
4. 在 Pages 项目中设置环境变量。
5. 推送代码到 `main` 后自动部署。

## 环境变量

### 必填
| 变量名 | 说明 |
| --- | --- |
| `PUBURL` | R2 公共桶 URL（用于 `/raw/*` 读取） |

### 权限相关
| 变量名 | 示例 | 说明 |
| --- | --- | --- |
| `GUEST` | `public/` 或 `public/,upload/` | 游客允许写入的目录前缀（可选） |
| `admin:123456` | `*` | 管理员账号密码与可写目录（值为前缀列表） |
| `user1:123456` | `user1/,shared/` | 普通管理员账号密码与可写目录 |

说明：
- 账号密码通过“环境变量名”定义，格式为 `账号:密码`。
- 环境变量值为允许写入的目录前缀，多个前缀用英文逗号分隔。
- 避免在前后多写逗号，防止意外授权。

### 用量统计（可选）
| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `R2_QUOTA_BYTES` | `10737418240` | 配额字节数，默认 10GB |
| `BILLING_CYCLE_DAY` | `1` | 计费周期起始日（1-28） |

## 安全说明（重要）
- 当前默认模型是“写受控、读公开”：
  - 写接口（`/api/write/*`）有鉴权。
  - 读接口（`/raw/*`）依赖 `PUBURL`，对象可通过路径访问。
- 如果需要“私有读”，需要额外改造（例如给 `/raw/*` 增加鉴权或签名链接）。

## 本地调试
```bash
npm install
npm run dev
```

默认命令：
```bash
wrangler pages dev . --r2 BUCKET
```
