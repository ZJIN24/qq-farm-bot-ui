# 代码结构梳理

本文档用于快速理解 `qq-farm-bot-ui-main-3` 的整体结构、模块职责、运行链路和排查入口。

## 1. 项目整体定位

这是一个 **QQ 农场挂机后端 + Web 管理面板** 的组合项目，整体分为两部分：

- `core/`：Node.js 后端与 Bot 运行时
- `web/`：Vue 3 + Vite 前端管理面板

运行时形态是：

1. 主进程启动管理面板与运行时引擎
2. 运行时引擎按账号拉起 Worker
3. Worker 负责单账号协议连接、心跳、农场/好友/任务等业务
4. Web 面板通过 HTTP + Socket.IO 与后端交互

---

## 2. 顶层目录

```text
.
├── core/                  # 后端、运行时、协议、业务逻辑
├── web/                   # 前端管理面板
├── package.json           # workspace 顶层脚本
├── pnpm-workspace.yaml    # pnpm workspace 配置
├── README.md              # 项目说明
└── CODE_STRUCTURE.md      # 当前这份结构文档
```

### 顶层脚本

根目录 `package.json` 主要负责统一调用：

- `pnpm dev:core`：启动后端
- `pnpm dev:web`：启动前端开发服务
- `pnpm build:web`：构建前端
- `pnpm dev`：先构建前端，再启动后端

---

## 3. 启动链路

### 3.1 主入口

主入口在：

- `core/client.js`

职责：

- 判断当前是主进程还是 Worker 进程
- 主进程下创建 `runtime engine`
- 启动管理面板 `admin server`
- 自动拉起已保存账号对应的 Worker

### 3.2 运行时引擎

核心编排在：

- `core/src/runtime/runtime-engine.js`

职责：

- 组装运行时状态、Worker 管理器、数据提供器、重登录提醒服务
- 启动 HTTP 管理面板
- 自动启动已有账号
- 对外暴露统一的数据接口给控制器层使用

### 3.3 Worker 管理

- `core/src/runtime/worker-manager.js`

职责：

- 启动 / 停止 / 重启单账号 Worker
- 管理线程或子进程模式
- 处理 Worker 状态同步
- 收集 Worker 日志并同步到账户资料
- 在账号离线、异常时触发提醒或清理逻辑

### 3.4 Worker 业务入口

- `core/src/core/worker.js`

职责：

- 单账号真正执行挂机逻辑
- 加载 Proto
- 建立协议连接
- 初始化状态栏、日志、统计
- 启动农场巡查、好友巡查、日常任务、出售果实等循环任务

---

## 4. 后端目录分层

## 4.1 `core/src/controllers`

### `admin.js`

这是后端 HTTP 与 Socket.IO 接口的统一入口。

主要职责：

- 登录鉴权
- 账号增删改查
- 启动 / 停止账号
- 获取状态、农场、好友、背包、分析数据
- 接收外部传入的 `code`
- 推送实时状态与日志到前端

可以把它理解为：

> “把 Web 面板的请求翻译成运行时调用”的适配层。

---

## 4.2 `core/src/runtime`

这一层负责“主进程如何管理多个账号”。

### `runtime-engine.js`
- 运行时总装配器

### `runtime-state.js`
- 保存全局日志、账号日志、运行时事件
- 构造默认状态
- 提供状态标准化能力

### `worker-manager.js`
- 管理 Worker 生命周期

### `data-provider.js`
- 给 `admin.js` 提供统一数据访问接口
- 屏蔽 Worker IPC 与 store 细节

### `relogin-reminder.js`
- 处理账号掉线后的重登录提醒
- 支持扫码轮询、接收新 `authCode`、重启账号

这层的定位是：

> “主进程编排层”。

---

## 4.3 `core/src/models`

### `store.js`

这是后端的核心本地数据模型层。

负责：

- 账号列表持久化
- 自动化配置持久化
- UI 设置持久化
- 好友黑名单、静默时段、间隔配置等存储
- 管理密码 Hash 存储

可以理解为：

> “项目的本地数据库抽象层”。

实际数据默认落在：

- `core/data/accounts.json`
- `core/data/store.json`

---

## 4.4 `core/src/services`

这一层是业务逻辑主战场，按功能拆分。

### 账号与基础能力

- `account-resolver.js`：账号 ID / 昵称 / UIN 的解析与归一化
- `logger.js`：统一日志输出与脱敏
- `security.js`：登录密码、速率限制等安全逻辑
- `rate-limiter.js`：请求频率限制辅助
- `config-validator.js`：配置合法性校验
- `scheduler.js` / `scheduler-optimized.js`：任务调度器
- `stats.js`：统计操作次数、金币、经验等运行指标
- `status.js`：账号运行状态、展示状态维护
- `common.js`：日常奖励、公用奖励格式化等公共逻辑

### 登录与连接

- `qrlogin.js`：二维码登录 / 小程序登录 code 获取
- `push.js`：离线提醒与推送能力

### 农场主业务

- `farm.js`：自己农场巡查、收获、种植、浇水、除草、除虫、升级土地
- `friend.js`：好友农场访问、帮忙、偷菜、捣乱
- `warehouse.js`：背包、出售、使用道具
- `task.js`：任务检查与奖励领取
- `mall.js`：商城与免费礼包
- `share.js`：分享奖励
- `monthcard.js`：月卡奖励
- `qqvip.js`：会员奖励
- `openserver.js`：开服红包
- `email.js`：邮件领取
- `invite.js`：邀请 / 分享相关处理
- `analytics.js`：作物效率分析、排序策略支撑

这层是：

> “面向业务功能拆分的服务层”。

---

## 4.5 `core/src/utils`

这一层主要是协议与通用工具。

### `network.js`

协议网络层核心，负责：

- WebSocket 连接
- 登录请求发送
- 心跳维护
- 请求/响应回调匹配
- 推送消息分发
- 用户态信息同步

### `crypto-wasm.js`
- 加载 `tsdk.wasm`
- 对请求体做协议加密

### `tsdk.wasm`
- 协议加密所需的 wasm 资源

### `proto.js`
- 加载全部 `.proto`
- 建立消息类型映射

### `utils.js`
- 通用数值、时间、日志函数

### `qrutils.js`
- 二维码登录辅助工具

这一层是：

> “底层协议与通用工具层”。

---

## 4.6 `core/src/config`

### `config.js`
- 运行常量
- 网关地址
- 客户端版本
- 设备信息
- 心跳与默认间隔

### `gameConfig.js`
- 加载游戏配置 JSON
- 提供植物、种子、果实、等级经验等查询函数
- 为分析页和自动种植策略提供基础数据

### `runtime-paths.js`
- 统一处理源码运行和打包运行时的资源路径

---

## 4.7 `core/src/proto`

存放游戏相关协议定义：

- `game.proto`：网关壳层消息
- `userpb.proto`：登录、心跳、基础资料
- `plantpb.proto`：农场相关
- `friendpb.proto`：好友相关
- `itempb.proto`：背包与道具
- `taskpb.proto`：任务相关
- `mallpb.proto` / `shoppb.proto`：商城 / 商店
- `sharepb.proto` / `emailpb.proto` / `qqvippb.proto` 等：其他业务协议

这一层决定了：

> “发给服务器什么、从服务器读回什么”。

---

## 4.8 `core/src/gameConfig`

这里是静态配置数据：

- `Plant.json`：植物配置
- `ItemInfo.json`：物品、种子、果实、价格等
- `RoleLevel.json`：等级经验表

这是分析、种植策略、价格计算的基础数据源。

---

## 5. 前端目录分层

## 5.1 `web/src/main.ts`

前端入口：

- 创建 Vue 应用
- 注入路由与 Pinia
- 挂载应用

## 5.2 `web/src/router`

### `index.ts`
- 定义路由守卫
- 处理登录态校验

### `menu.ts`
- 定义侧边栏菜单与页面映射

---

## 5.3 `web/src/api`

### `index.ts`

统一封装前端请求：

- Axios 实例
- 自动带上 `x-admin-token`
- 401 等错误处理

这是前端与后端接口的统一出口。

---

## 5.4 `web/src/stores`

Pinia 状态管理层。

### 典型 store

- `account.ts`：账号列表、当前账号、账号操作
- `status.ts`：账号状态
- `farm.ts`：农场数据
- `friend.ts`：好友数据
- `bag.ts`：背包数据
- `setting.ts`：设置页配置
- `app.ts`：全局 UI 状态
- `toast.ts`：消息通知

可以理解为：

> “页面与接口之间的前端状态中间层”。

---

## 5.5 `web/src/views`

页面级视图。

- `Login.vue`：登录页
- `Dashboard.vue`：总览页
- `Accounts.vue`：账号管理页
- `Friends.vue`：好友页
- `Analytics.vue`：作物分析页
- `Settings.vue`：设置页
- `Personal.vue`：个人信息页

---

## 5.6 `web/src/components`

通用组件与业务面板组件。

### 业务组件
- `AccountModal.vue`：新增 / 编辑账号
- `FarmPanel.vue`：农场面板
- `BagPanel.vue`：背包面板
- `TaskPanel.vue`：任务面板
- `DailyOverview.vue`：概览卡片
- `LandCard.vue`：单块土地展示

### 基础与布局组件
- `Sidebar.vue`
- `ThemeToggle.vue`
- `ToastContainer.vue`
- `ConfirmModal.vue`
- `RemarkModal.vue`

---

## 6. 关键运行数据流

## 6.1 账号启动链路

```text
core/client.js
  -> runtime-engine.js
    -> worker-manager.js
      -> core/worker.js
        -> utils/proto.js
        -> utils/network.js
        -> services/*
```

说明：

- 主进程只负责编排
- 单账号实际逻辑在 Worker 中运行
- Worker 通过 `network.js` 与游戏服务器通信

---

## 6.2 Web 面板调用链路

```text
Vue 页面
  -> stores/*
    -> api/index.ts
      -> controllers/admin.js
        -> runtime/data-provider.js
          -> Worker API / store.js
```

说明：

- 页面不直接处理复杂业务
- 前端统一经由 store 和 api 层
- 后端控制器再调用 data-provider 访问运行时或本地存储

---

## 6.3 协议通信链路

```text
services/*.js
  -> utils/network.js
    -> utils/crypto-wasm.js
      -> tsdk.wasm
    -> utils/proto.js
      -> core/src/proto/*.proto
```

说明：

- 业务服务只关心“发什么请求”
- `network.js` 负责收发、加密、心跳和回调
- `proto.js` 负责消息编码/解码

---

## 6.4 重登录链路

```text
外部 code / 面板提交 code
  -> controllers/admin.js (/api/code/receive 或 /api/accounts)
    -> runtime/data-provider.js
      -> relogin-reminder.js
        -> store.js 更新账号
        -> worker-manager.js 重启账号
```

---

## 7. 目前最值得关注的核心文件

如果要继续开发或排查，推荐优先看这些文件：

### 入口与编排
- `core/client.js`
- `core/src/runtime/runtime-engine.js`
- `core/src/runtime/worker-manager.js`
- `core/src/core/worker.js`

### 协议与登录
- `core/src/utils/network.js`
- `core/src/utils/crypto-wasm.js`
- `core/src/utils/proto.js`
- `core/src/services/qrlogin.js`
- `core/src/proto/userpb.proto`
- `core/src/proto/game.proto`

### 业务主逻辑
- `core/src/services/farm.js`
- `core/src/services/friend.js`
- `core/src/services/task.js`
- `core/src/services/warehouse.js`
- `core/src/services/analytics.js`

### 数据与配置
- `core/src/models/store.js`
- `core/src/config/config.js`
- `core/src/config/gameConfig.js`
- `core/src/gameConfig/Plant.json`
- `core/src/gameConfig/ItemInfo.json`

### 前端主线
- `web/src/router/index.ts`
- `web/src/api/index.ts`
- `web/src/stores/account.ts`
- `web/src/views/Dashboard.vue`
- `web/src/views/Analytics.vue`
- `web/src/components/AccountModal.vue`

---

## 8. 推荐阅读顺序

如果你要快速接手这个项目，建议按下面顺序读：

1. `README.md`
2. `core/client.js`
3. `core/src/runtime/runtime-engine.js`
4. `core/src/runtime/worker-manager.js`
5. `core/src/core/worker.js`
6. `core/src/utils/network.js`
7. `core/src/services/farm.js`
8. `core/src/models/store.js`
9. `core/src/controllers/admin.js`
10. `web/src/api/index.ts`
11. `web/src/stores/account.ts`
12. `web/src/views/*`

---

## 9. 一句话总结

这个仓库本质上是一个：

> **“主进程编排多个账号 Worker，Worker 通过自定义 Proto + WebSocket 协议操作 QQ 农场，Web 前端通过 HTTP/Socket.IO 做可视化管理”的项目。**

其中：

- `runtime` 解决“怎么管理多个账号”
- `worker + services` 解决“账号具体做什么”
- `network + proto + wasm` 解决“怎么和游戏服务器说话”
- `web + admin controller` 解决“怎么让人管它”

