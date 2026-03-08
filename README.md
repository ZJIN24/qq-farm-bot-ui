# QQ 农场多账号挂机 + Web 面板

基于 Node.js 的 QQ 农场自动化工具，提供多账号管理、自动巡查、Web 控制面板、实时日志与数据分析能力。


## 主要功能

### 多账号管理
- 支持账号新增、编辑、删除、启动、停止、保存
- 支持二维码登录、手动输入 Code、手机转发抓包中的 Code 登录
- 支持根据 `/api/code/receive` 中的 `platform` 自动识别 `qq` / `wx`
- 收到新的登录 Code 后，会尽量复用同一账号并合并重复账号数据
- 已保存账号掉线后不会自动删除，临时账号停止后可直接清理
- 账号列表支持动态编号、备注、昵称、头像展示

### 自动化巡查
- 农场自动收获、种植、浇水、除草、除虫、铲除枯株
- 支持按土地等级分别设置施肥策略
- 支持自动出售果实、自动开礼包、自动领取邮箱与任务奖励
- 好友支持自动偷菜、自动帮忙、自动捣乱
- 支持好友黑名单与静默时段，减少不想要的好友操作
- 支持默认策略模板，新登录账号可自动继承常用配置

### Web 面板
- 提供概览、农场、背包、好友、账号、设置、分析等页面
- 实时显示运行状态、等级、经验进度、今日统计、下次巡查倒计时
- 支持按账号查看日志，账号日志与系统日志分开维护
- 支持实时日志推送与 HTTP 回退刷新
- 支持深色 / 浅色主题切换，移动端可直接访问

### 下线提醒与接码能力
- 支持离线提醒、二维码提醒、登录链接推送
- 支持 Webhook、Bark 及 `pushoo` 支持的其他渠道
- 支持测试推送接口
- 支持在服务器监听手机转发的登录包并提取其中的 Code

### 数据分析
- 作物分析支持按经验效率、净利润效率、等级要求等维度排序
- 背包页可查看主要物品与库存统计
- 首页展示化肥、典藏、经验速度等关键指标

---

## 技术栈

**后端**

[<img src="https://skillicons.dev/icons?i=nodejs" height="48" title="Node.js 20+" />](https://nodejs.org/)
[<img src="https://skillicons.dev/icons?i=express" height="48" title="Express 4" />](https://expressjs.com/)
[<img src="https://skillicons.dev/icons?i=socketio" height="48" title="Socket.io 4" />](https://socket.io/)

**前端**

[<img src="https://skillicons.dev/icons?i=vue" height="48" title="Vue 3" />](https://vuejs.org/)
[<img src="https://skillicons.dev/icons?i=vite" height="48" title="Vite 7" />](https://vitejs.dev/)
[<img src="https://skillicons.dev/icons?i=ts" height="48" title="TypeScript 5" />](https://www.typescriptlang.org/)
[<img src="https://cdn.simpleicons.org/pinia/FFD859" height="48" title="Pinia 3" />](https://pinia.vuejs.org/)
[<img src="https://skillicons.dev/icons?i=unocss" height="48" title="UnoCSS" />](https://unocss.dev/)

**部署**

[<img src="https://skillicons.dev/icons?i=docker" height="48" title="Docker Compose" />](https://docs.docker.com/compose/)
[<img src="https://skillicons.dev/icons?i=pnpm" height="48" title="pnpm 10" />](https://pnpm.io/)
[<img src="https://skillicons.dev/icons?i=githubactions" height="48" title="GitHub Actions" />](https://github.com/features/actions)

---

## 运行环境

- Node.js `20+`
- pnpm `10+`（推荐执行 `corepack enable`）
- Docker / Docker Compose（如果使用容器部署）

当前核心版本：`2.0.4`

---

## 快速开始

### 方式一：源码运行

```bash
corepack enable
pnpm install
pnpm build:web
pnpm dev:core
```

启动后访问：
- 本机：`http://localhost:3000`
- 局域网：`http://<你的服务器IP>:3000`

### 方式二：一条命令启动

```bash
corepack enable
pnpm install
pnpm dev
```

这个命令会先构建前端，再启动后端服务。

---

## Docker 部署

项目当前使用的是 `docker-compose` 风格配置，默认端口为 `3000`。

```bash
# 构建并后台启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 重启服务
docker-compose up -d --build

# 停止并移除容器
docker-compose down
```

### 数据持久化

`docker-compose.yml` 已将数据目录挂载到容器内：

| 宿主机路径 | 容器内路径 |
| --- | --- |
| `./data` | `/app/core/data` |

常见数据文件：
- `data/accounts.json`：账号列表、账号配置、保存状态
- `data/store.json`：全局配置、默认策略、下线提醒等

### 管理密码

默认管理密码为 `admin`，建议部署后立即修改。

也可以在 `docker-compose.yml` 中直接配置：

```yaml
environment:
  ADMIN_PASSWORD: 你的强密码
  TZ: Asia/Shanghai
```

修改后重新执行：

```bash
docker-compose up -d --build
```

---

## 登录方式

### 面板内登录
- 手动输入登录 Code

### 手机转发 Code 登录
重定向包含code的包到
http://服务器公网ip:3000/api/code/receive

把请求转发到你的服务器即可。服务端会：
- 解析 `code`
- 根据 `platform` 判断是 QQ 还是微信
- 尝试匹配现有账号
- 同步原账号配置
- 合并重复账号并保留可用数据

适合放在代理工具、抓包转发规则或自定义脚本里使用。

---

## 功能说明

### 账号保存机制
- `保存`：保留当前账号的偷菜、种植、施肥等配置；掉线后不自动删除
- `停止`：已保存账号只停止运行，不删数据
- `删除`：临时账号停止后可直接清掉，适合一次性登录测试

### 默认策略
在设置页可以把当前账号配置设为默认策略。之后新登录账号会自动继承这些内容：
- 种植策略
- 施肥策略
- 巡视与好友策略
- 静默时段等自动化设置

### 日志系统
- 系统日志和账号日志分开维护
- 首页支持按模块、事件、级别筛选
- 支持实时推送，断开后自动回退为接口拉取
- 最新收到的 Code 会在日志区上方提示

### 推送提醒
下线提醒支持多种渠道，常用包括：
- `webhook`
- `bark`
- `qmsg`
- `serverchan`
- `pushplus`
- 以及 `pushoo` 支持的其他渠道

---

## 常用命令

```bash
# 启动后端
pnpm dev:core

# 启动前端开发模式
pnpm dev:web

# 构建前端
pnpm build:web

# 代码检查
pnpm lint

# 打包所有发布版
pnpm package:release
```

---

## 二进制发布版

如果你不想安装 Node.js，也可以自行打包发布版：

```bash
pnpm install
pnpm package:release
```

产物输出在 `core/dist/` 目录。

可执行文件运行后，会在程序同级目录附近创建并使用自己的数据目录，保存账号与配置数据。

---

## 项目结构

```text
qq-farm-bot-ui/
├── core/                  # 后端服务与机器人核心
│   ├── src/
│   │   ├── config/        # 游戏配置与静态资源映射
│   │   ├── controllers/   # HTTP API 与后台接口
│   │   ├── core/          # Worker 与实际巡查执行逻辑
│   │   ├── gameConfig/    # 游戏静态数据
│   │   ├── models/        # 数据持久化与状态存储
│   │   ├── runtime/       # 运行时引擎、日志、重登录管理
│   │   ├── services/      # 农场、好友、任务、仓库等业务逻辑
│   │   └── utils/         # 网络、协议、工具函数
│   ├── client.js          # 后端入口
│   └── Dockerfile         # 容器构建文件
├── web/                   # Vue 3 前端面板
│   ├── src/
│   │   ├── api/           # API 封装
│   │   ├── components/    # 页面与通用组件
│   │   ├── stores/        # Pinia 状态管理
│   │   └── views/         # 各功能页面
│   └── dist/              # 前端构建产物
├── data/                  # Docker 挂载后的运行数据目录
├── docker-compose.yml     # 容器部署配置
├── pnpm-workspace.yaml    # pnpm 工作区配置
└── README.md
```

如需更细的代码结构说明，可查看 `CODE_STRUCTURE.md`。

---

## 贡献说明

欢迎提交问题反馈与改进建议。

如果你要提交代码修改，建议：
- 先同步最新代码
- 在自己的分支完成修改
- 确保能正常启动、构建与基本功能验证
- 再发起合并请求

---

## 特别感谢

- 核心功能参考：[linguo2625469/qq-farm-bot](https://github.com/linguo2625469/qq-farm-bot)
- 部分功能参考：[QianChenJun/qq-farm-bot](https://github.com/QianChenJun/qq-farm-bot)

## 免责声明

本项目仅供学习与研究用途。使用本工具可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。
