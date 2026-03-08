const { fork } = require('node:child_process')
const path = require('node:path')
const process = require('node:process');
const { Worker } = require('node:worker_threads')
const store = require('../models/store')
const { sendPushooMessage } = require('../services/push')
const { MiniProgramLoginSession } = require('../services/qrlogin')
const { createDataProvider } = require('./data-provider')
const { createReloginReminderService } = require('./relogin-reminder')
const { createRuntimeState } = require('./runtime-state')
const { createWorkerManager } = require('./worker-manager')

const OPERATION_KEYS = ['harvest', 'water', 'weed', 'bug', 'fertilize', 'plant', 'steal', 'helpWater', 'helpWeed', 'helpBug', 'taskClaim', 'sell', 'upgrade']

function createRuntimeEngine(options = {}) {
  const processRef = options.processRef || process
  const mainEntryPath = options.mainEntryPath || path.join(__dirname, '../../client.js')
  const workerScriptPath = options.workerScriptPath || path.join(__dirname, '../core/worker.js')
  const runtimeMode = String(options.runtimeMode || processRef.env.FARM_RUNTIME_MODE || 'thread').toLowerCase()
  const onStatusSync = typeof options.onStatusSync === 'function' ? options.onStatusSync : null
  const onLog = typeof options.onLog === 'function' ? options.onLog : null
  const onAccountLog = typeof options.onAccountLog === 'function' ? options.onAccountLog : null
  const startAdminServer = typeof options.startAdminServer === 'function' ? options.startAdminServer : null

  const workerControls = { startWorker: null, restartWorker: null, workers: null }
  const runtimeState = createRuntimeState({
    store,
    operationKeys: OPERATION_KEYS,
  })
  const {
    workers,
    globalLogs: GLOBAL_LOGS,
    accountLogs: ACCOUNT_LOGS,
    runtimeEvents,
    nextConfigRevision,
    buildConfigSnapshotForAccount,
    log,
    addAccountLog,
    normalizeStatusForPanel,
    buildDefaultStatus,
    filterLogs,
  } = runtimeState

  function normalizeAccountText(value) {
    return String(value || '').trim()
  }

  function isGenericAccountName(name = '', accountId = '') {
    const text = normalizeAccountText(name)
    if (!text) return true
    if (normalizeAccountText(accountId) && text === normalizeAccountText(accountId)) return true
    return /^账号\d+$/.test(text)
  }

  function mergeRuntimeAccounts({ sourceAccountId = '', targetAccountId = '', targetAccountName = '' } = {}) {
    const sourceId = normalizeAccountText(sourceAccountId)
    const targetId = normalizeAccountText(targetAccountId)
    if (!sourceId || !targetId || sourceId === targetId)
      return false

    const accountsData = store.getAccounts ? store.getAccounts() : { accounts: [] }
    const accounts = Array.isArray(accountsData.accounts) ? accountsData.accounts : []
    const sourceAccount = accounts.find(acc => normalizeAccountText(acc && acc.id) === sourceId) || null
    const targetAccount = accounts.find(acc => normalizeAccountText(acc && acc.id) === targetId) || null

    const preferredTargetName = isGenericAccountName(targetAccount && targetAccount.name, targetId)
      ? normalizeAccountText((sourceAccount && sourceAccount.name) || targetAccountName || (targetAccount && targetAccount.name) || targetId)
      : normalizeAccountText(targetAccountName || (targetAccount && targetAccount.name) || targetId)
    const nextTargetName = preferredTargetName || targetId

    const sourceSnapshot = store.getConfigSnapshot ? store.getConfigSnapshot(sourceId) : null
    if (sourceSnapshot && store.applyConfigSnapshot) {
      store.applyConfigSnapshot({
        automation: sourceSnapshot.automation,
        fertilizerByLandLevel: sourceSnapshot.fertilizerByLandLevel,
        plantingStrategy: sourceSnapshot.plantingStrategy,
        preferredSeedId: sourceSnapshot.preferredSeedId,
        intervals: sourceSnapshot.intervals,
        friendQuietHours: sourceSnapshot.friendQuietHours,
        friendBlacklist: sourceSnapshot.friendBlacklist,
      }, { accountId: targetId })
    }

    const mergePatch = { id: targetId }
    if (nextTargetName && normalizeAccountText(targetAccount && targetAccount.name) !== nextTargetName) mergePatch.name = nextTargetName
    const mergedPlatform = normalizeAccountText((targetAccount && targetAccount.platform) || (sourceAccount && sourceAccount.platform)).toLowerCase()
    if (mergedPlatform === 'qq' || mergedPlatform === 'wx') mergePatch.platform = mergedPlatform
    if (!(targetAccount && targetAccount.uin) && sourceAccount && sourceAccount.uin) mergePatch.uin = sourceAccount.uin
    if (!(targetAccount && targetAccount.qq) && sourceAccount && sourceAccount.qq) mergePatch.qq = sourceAccount.qq
    if (!(targetAccount && targetAccount.gid) && sourceAccount && sourceAccount.gid) mergePatch.gid = sourceAccount.gid
    if (!(targetAccount && targetAccount.avatar) && sourceAccount && sourceAccount.avatar) mergePatch.avatar = sourceAccount.avatar
    if (!(targetAccount && targetAccount.nick) && sourceAccount && sourceAccount.nick) mergePatch.nick = sourceAccount.nick
    if (!!(sourceAccount && sourceAccount.saved) && !(targetAccount && targetAccount.saved)) mergePatch.saved = true
    store.addOrUpdateAccount(mergePatch)

    for (const entry of GLOBAL_LOGS) {
      if (String((entry && entry.accountId) || '') !== sourceId) continue
      entry.accountId = targetId
      if (nextTargetName) entry.accountName = nextTargetName
      entry._searchText = `${entry.msg || ''} ${entry.tag || ''} ${JSON.stringify(entry.meta || {})}`.toLowerCase()
    }

    for (const entry of ACCOUNT_LOGS) {
      if (String((entry && entry.accountId) || '') !== sourceId) continue
      entry.accountId = targetId
      if (nextTargetName) entry.accountName = nextTargetName
    }

    try {
      stopWorker(sourceId)
    } catch {}

    try {
      store.deleteAccount(sourceId)
    } catch (error) {
      const message = error && error.message ? error.message : String(error || 'unknown')
      log('错误', `合并重复账号失败: ${message}`, { accountId: targetId, accountName: nextTargetName, mergedFrom: sourceId })
      return false
    }

    addAccountLog('merge', `已合并重复账号: ${(sourceAccount && sourceAccount.name) || sourceId} -> ${nextTargetName}`, targetId, nextTargetName, { reason: 'merge', mergedFrom: sourceId, mergedFromName: sourceAccount ? sourceAccount.name : '' })
    log('系统', `已合并重复账号: ${(sourceAccount && sourceAccount.name) || sourceId} -> ${nextTargetName}`, { accountId: targetId, accountName: nextTargetName, mergedFrom: sourceId })
    return true
  }

  const reloginReminder = createReloginReminderService({
    store,
    miniProgramLoginSession: MiniProgramLoginSession,
    sendPushooMessage,
    log,
    addAccountLog,
    getAccounts: store.getAccounts,
    addOrUpdateAccount: store.addOrUpdateAccount,
    resolveWorkerControls: () => workerControls,
    mergeAccounts: mergeRuntimeAccounts,
  })

  const {
    getOfflineAutoDeleteMs,
    triggerOfflineReminder,
    applyReloginCode,
    handleReceivedCode,
  } = reloginReminder

  const { startWorker, stopWorker, restartWorker, callWorkerApi } = createWorkerManager({
    fork,
    WorkerThread: Worker,
    runtimeMode,
    processRef,
    mainEntryPath,
    workerScriptPath,
    workers,
    globalLogs: GLOBAL_LOGS,
    log,
    addAccountLog,
    normalizeStatusForPanel,
    buildConfigSnapshotForAccount,
    getOfflineAutoDeleteMs,
    triggerOfflineReminder,
    addOrUpdateAccount: store.addOrUpdateAccount,
    deleteAccount: store.deleteAccount,
    getAccounts: store.getAccounts,
    mergeAccounts: mergeRuntimeAccounts,
    upsertFriendBlacklist: (accountId, gid) => {
      const id = String(accountId || '').trim()
      const friendGid = Number(gid)
      if (!id || !Number.isFinite(friendGid) || friendGid <= 0) return false
      const current = store.getFriendBlacklist ? store.getFriendBlacklist(id) : []
      const list = Array.isArray(current) ? current : []
      if (list.includes(friendGid)) return false
      if (store.setFriendBlacklist) {
        store.setFriendBlacklist(id, [...list, friendGid])
        return true
      }
      return false
    },
    broadcastConfigToWorkers,
    onStatusSync: (accountId, status, accountName) => {
      runtimeEvents.emit('status', { accountId, status, accountName })
      if (onStatusSync) onStatusSync(accountId, status, accountName)
    },
    onWorkerLog: (entry, accountId, accountName) => {
      runtimeEvents.emit('worker_log', { entry, accountId, accountName })
      if (onLog) onLog(entry, accountId, accountName)
    },
  })
  workerControls.startWorker = startWorker
  workerControls.restartWorker = restartWorker
  workerControls.workers = workers

  const dataProvider = createDataProvider({
    workers,
    globalLogs: GLOBAL_LOGS,
    accountLogs: ACCOUNT_LOGS,
    store,
    getAccounts: store.getAccounts,
    callWorkerApi,
    buildDefaultStatus,
    normalizeStatusForPanel,
    filterLogs,
    addAccountLog,
    nextConfigRevision,
    broadcastConfigToWorkers,
    startWorker,
    stopWorker,
    restartWorker,
    handleReceivedCode,
    applyReloginCode,
  })

  runtimeEvents.on('log', (entry) => {
    if (onLog) onLog(entry, entry && entry.accountId ? entry.accountId : '', entry && entry.accountName ? entry.accountName : '')
  })
  runtimeEvents.on('account_log', (entry) => {
    if (onAccountLog) onAccountLog(entry)
  })

  function broadcastConfigToWorkers(targetAccountId = '') {
    const targetId = String(targetAccountId || '').trim()
    for (const [accId, worker] of Object.entries(workers)) {
      if (targetId && String(accId) !== targetId) continue
      const snapshot = buildConfigSnapshotForAccount(accId)
      try {
        worker.process.send({ type: 'config_sync', config: snapshot })
      }
      catch {
        // ignore IPC failures for exited workers
      }
    }
  }

  function startAllAccounts() {
    const accounts = (store.getAccounts().accounts || [])
    if (accounts.length > 0) {
      log('系统', `发现 ${accounts.length} 个账号，正在启动...`)
      accounts.forEach(acc => startWorker(acc))
    }
    else {
      log('系统', '未发现账号，请访问管理面板添加账号')
    }
  }

  async function start(options = {}) {
    const shouldStartAdminServer = options.startAdminServer !== false
    const shouldAutoStartAccounts = options.autoStartAccounts !== false

    if (shouldStartAdminServer && startAdminServer) {
      startAdminServer(dataProvider)
    }

    if (shouldAutoStartAccounts) {
      startAllAccounts()
    }
  }

  function stopAllAccounts() {
    for (const accountId of Object.keys(workers)) {
      stopWorker(accountId)
    }
  }

  return {
    store,
    runtimeEvents,
    workers,
    dataProvider,
    start,
    startAllAccounts,
    stopAllAccounts,
    broadcastConfigToWorkers,
    startWorker,
    stopWorker,
    restartWorker,
    callWorkerApi,
    log,
    addAccountLog,
  }
}

module.exports = {
  createRuntimeEngine,
}
