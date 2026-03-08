const { sleep } = require('../utils/utils');
const QRCode = require('qrcode');

function createReloginReminderService(options) {
    const {
        store,
        miniProgramLoginSession,
        sendPushooMessage,
        log,
        addAccountLog,
        getAccounts,
        addOrUpdateAccount,
        resolveWorkerControls,
        mergeAccounts,
    } = options;

    const reloginWatchers = new Map();

    function normalizeText(value) {
        return String(value || '').trim();
    }

    function normalizePlatform(value) {
        const text = normalizeText(value).toLowerCase();
        if (!text) return '';
        if (text === 'wx' || text === 'wechat' || text === 'weixin') return 'wx';
        if (text === 'qq') return 'qq';
        return '';
    }

    function maskCode(code) {
        const text = normalizeText(code);
        return text.length > 8 ? `${text.slice(0, 4)}***${text.slice(-4)}` : '***';
    }

    function isGenericAccountName(name, accountId = '') {
        const text = normalizeText(name);
        if (!text) return true;
        if (normalizeText(accountId) && text === normalizeText(accountId)) return true;
        return /^账号\d+$/.test(text);
    }

    function getRuntimeControls() {
        return typeof resolveWorkerControls === 'function' ? (resolveWorkerControls() || {}) : {};
    }

    function getRuntimeWorkers() {
        const controls = getRuntimeControls();
        return controls && typeof controls.workers === 'object' && controls.workers ? controls.workers : {};
    }

    function getAccountUin(account) {
        return normalizeText((account && (account.uin || account.qq)) || '');
    }

    function sortAccounts(list = []) {
        return [...list].sort((left, right) => {
            const leftId = Number.parseInt(normalizeText(left && left.id), 10);
            const rightId = Number.parseInt(normalizeText(right && right.id), 10);
            if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
                return leftId - rightId;
            }
            return normalizeText(left && left.id).localeCompare(normalizeText(right && right.id));
        });
    }
    function pickPrimaryAccount(list, context = {}) {
        const accounts = sortAccounts(list);
        const normalizedId = normalizeText(context.accountId);
        const normalizedName = normalizeText(context.accountName);
        const normalizedUin = normalizeText(context.uin);
        const workers = getRuntimeWorkers();

        if (normalizedId) {
            const foundById = accounts.find(account => normalizeText(account && account.id) === normalizedId);
            if (foundById) return foundById;
        }

        if (normalizedUin) {
            const matchedByUin = accounts.filter((account) => {
                const accountUin = getAccountUin(account);
                return accountUin && accountUin === normalizedUin;
            });
            if (matchedByUin.length === 1) return matchedByUin[0];
            if (matchedByUin.length > 1) {
                const runningMatches = matchedByUin.filter(account => !!workers[normalizeText(account && account.id)]);
                if (runningMatches.length === 1) return runningMatches[0];

                const namedMatches = matchedByUin.filter(account => !isGenericAccountName(account && account.name, account && account.id));
                if (namedMatches.length === 1) return namedMatches[0];

                return sortAccounts(matchedByUin)[0] || null;
            }
        }

        if (normalizedName) {
            const matchedByName = accounts.filter((account) => {
                const name = normalizeText(account && account.name);
                const nick = normalizeText(account && account.nick);
                return name === normalizedName || nick === normalizedName;
            });
            if (matchedByName.length === 1) return matchedByName[0];
        }

        return null;
    }

    function collectDuplicateAccounts(list, primaryAccount, { uin = '' } = {}) {
        if (!primaryAccount) return [];
        const primaryId = normalizeText(primaryAccount.id);
        const identityUin = normalizeText(uin) || getAccountUin(primaryAccount);
        if (!identityUin) return [];

        return sortAccounts(list).filter((account) => {
            const accountId = normalizeText(account && account.id);
            return accountId && accountId !== primaryId && getAccountUin(account) === identityUin;
        });
    }

    function mergeDuplicateAccounts(duplicates, primaryAccount) {
        if (!Array.isArray(duplicates) || duplicates.length === 0) return;
        if (typeof mergeAccounts !== 'function' || !primaryAccount) return;

        for (const duplicate of duplicates) {
            try {
                mergeAccounts({
                    sourceAccountId: normalizeText(duplicate && duplicate.id),
                    targetAccountId: normalizeText(primaryAccount && primaryAccount.id),
                    targetAccountName: normalizeText(primaryAccount && primaryAccount.name),
                });
            } catch (error) {
                const message = error && error.message ? error.message : String(error || 'unknown');
                log('错误', `[Code接收] 合并重复账号失败: ${message}`, {
                    accountId: normalizeText(primaryAccount && primaryAccount.id),
                    accountName: normalizeText(primaryAccount && primaryAccount.name),
                    mergedFrom: normalizeText(duplicate && duplicate.id),
                });
            }
        }
    }

    function getOfflineAutoDeleteMs() {
        const cfg = store.getOfflineReminder ? store.getOfflineReminder() : null;
        const sec = Math.max(1, Number.parseInt(cfg && cfg.offlineDeleteSec, 10) || 120);
        return sec * 1000;
    }

    function resolveReloginTarget(list, context = {}) {
        return pickPrimaryAccount(list, context);
    }

    function applyReloginCode({ accountId = '', accountName = '', authCode = '', uin = '', platform = '' }) {
        const code = normalizeText(authCode);
        if (!code) return null;

        const data = getAccounts();
        const list = Array.isArray(data.accounts) ? data.accounts : [];
        const found = resolveReloginTarget(list, { accountId, accountName, uin });
        const duplicates = collectDuplicateAccounts(list, found, { uin });
        const resolvedPlatform = normalizePlatform(platform) || normalizePlatform(found && found.platform) || 'qq';
        const avatar = resolvedPlatform === 'qq' && uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : '';
        const controls = getRuntimeControls();
        const startWorker = typeof controls.startWorker === 'function' ? controls.startWorker : null;
        const restartWorker = typeof controls.restartWorker === 'function' ? controls.restartWorker : null;
        const targetAccountId = normalizeText(found && found.id) || normalizeText(accountId);
        const targetAccountName = normalizeText(found && found.name) || normalizeText(accountName) || targetAccountId || (resolvedPlatform === 'wx' ? '微信账号' : '未知账号');
        const codeMask = maskCode(code);

        if (!uin) {
            log('系统', `[Code接收] 用 code 直接登录 (${codeMask})，正在更新/创建账号: ${targetAccountName}`, { accountId: targetAccountId, accountName: targetAccountName });
            addAccountLog('update', `[Code接收] 收到 code，已直接用于登录: ${targetAccountName}`, targetAccountId, targetAccountName, { reason: 'code_receive', codeLen: code.length, codeMask });
        }

        if (found) {
            mergeDuplicateAccounts(duplicates, found);
            addOrUpdateAccount({
                id: found.id,
                name: found.name,
                code,
                platform: resolvedPlatform,
                qq: uin || found.qq || found.uin || '',
                uin: uin || found.uin || found.qq || '',
                avatar: avatar || found.avatar || '',
            });
            if (restartWorker) {
                restartWorker({
                    ...found,
                    code,
                    platform: resolvedPlatform,
                    qq: uin || found.qq || found.uin || '',
                    uin: uin || found.uin || found.qq || '',
                    avatar: avatar || found.avatar || '',
                });
            }
            addAccountLog('update', `[Code接收] 登录成功，新 code 已应用，已更新账号: ${found.name}`, found.id, found.name, { reason: 'relogin', hasNewCode: true });
            log('系统', `[Code接收] 登录成功，新 authCode 已刷新，账号已更新并重启: ${found.name}`, { accountId: normalizeText(found.id), accountName: normalizeText(found.name) });
            return {
                ok: true,
                mode: 'account_updated',
                accountId: normalizeText(found.id),
                accountName: normalizeText(found.name),
                mergedCount: duplicates.length,
            };
        }

        const created = addOrUpdateAccount({
            name: accountName || (uin ? String(uin) : ''),
            code,
            platform: resolvedPlatform,
            qq: uin || '',
            uin: uin || '',
            avatar,
            saved: false,
        });
        const newAcc = (created.accounts || [])[created.accounts.length - 1];
        if (newAcc) {
            if (startWorker) startWorker(newAcc);
            addAccountLog('add', `[Code接收] 登录成功，新 code 已应用，已新增账号: ${newAcc.name}`, newAcc.id, newAcc.name, { reason: 'relogin', hasNewCode: true });
            log('系统', `登录成功，已新增账号并启动: ${newAcc.name}`, { accountId: normalizeText(newAcc.id), accountName: normalizeText(newAcc.name) });
            return {
                ok: true,
                mode: 'account_created',
                accountId: normalizeText(newAcc.id),
                accountName: normalizeText(newAcc.name),
                mergedCount: 0,
            };
        }

        return { ok: false, error: '创建账号失败' };
    }

    function startReloginWatcher({ loginCode, accountId = '', accountName = '' }) {
        const code = normalizeText(loginCode);
        if (!code) return false;

        const key = `${accountId || 'unknown'}:${code}`;
        if (reloginWatchers.has(key)) return true;
        reloginWatchers.set(key, { startedAt: Date.now() });

        const displayName = normalizeText(accountName) || normalizeText(accountId) || '未知账号';
        const codeMask = maskCode(code);
        log('系统', `[Code接收] 已解析并收到登录 code (${codeMask})，启动重登录监听: ${displayName}`, { accountId: normalizeText(accountId), accountName: normalizeText(accountName) });
        addAccountLog('update', `[Code接收] 收到登录 code，正在监听扫码: ${displayName}`, normalizeText(accountId), displayName, { reason: 'code_receive', codeLen: code.length, codeMask });

        let stopped = false;
        const stop = () => {
            if (stopped) return;
            stopped = true;
            reloginWatchers.delete(key);
        };

        (async () => {
            const maxRounds = 120;
            for (let i = 0; i < maxRounds; i += 1) {
                try {
                    const status = await miniProgramLoginSession.queryStatus(code);
                    if (!status || status.status === 'Wait') {
                        await sleep(1000);
                        continue;
                    }
                    if (status.status === 'Used') {
                        log('系统', `重登录二维码已失效: ${accountName || accountId || '未知账号'}`, { accountId: normalizeText(accountId), accountName: normalizeText(accountName) });
                        stop();
                        return;
                    }
                    if (status.status === 'OK') {
                        const ticket = normalizeText(status.ticket);
                        const uin = normalizeText(status.uin);
                        if (!ticket) {
                            log('错误', '重登录监听失败: ticket 为空');
                            stop();
                            return;
                        }
                        const authCode = await miniProgramLoginSession.getAuthCode(ticket, '1112386029');
                        if (!authCode) {
                            log('错误', '重登录监听失败: 未获取到新 code');
                            stop();
                            return;
                        }
                        const authCodeMask = maskCode(authCode);
                        log('系统', `[Code接收] 已获取新 authCode (${authCodeMask})，uin=${uin || '未知'}，即将刷新账号`, { accountId: normalizeText(accountId), accountName: normalizeText(accountName) });
                        addAccountLog('update', `[Code接收] 已获取新 code (authCode)，uin=${uin || '未知'}，正在更新登录状态`, normalizeText(accountId), displayName, { reason: 'code_receive', hasAuthCode: !!authCode });
                        applyReloginCode({ accountId, accountName, authCode, uin, platform: 'qq' });
                        stop();
                        return;
                    }
                    await sleep(1000);
                } catch {
                    await sleep(1000);
                }
            }
            log('系统', `重登录监听超时: ${accountName || accountId || '未知账号'}`, { accountId: normalizeText(accountId), accountName: normalizeText(accountName) });
            stop();
        })();

        return true;
    }

    async function handleReceivedCode({ code = '', authCode = '', loginCode = '', ticket = '', accountId = '', accountName = '', uin = '', platform = '' } = {}) {
        const directAuthCode = normalizeText(authCode);
        const directLoginCode = normalizeText(loginCode);
        const directTicket = normalizeText(ticket);
        const rawCode = normalizeText(code);
        const resolvedAccountId = normalizeText(accountId);
        const resolvedAccountName = normalizeText(accountName);
        const resolvedUin = normalizeText(uin);
        const resolvedPlatform = normalizePlatform(platform);
        const currentAccountsData = getAccounts();
        const currentAccounts = Array.isArray(currentAccountsData.accounts) ? currentAccountsData.accounts : [];
        const preMatchedAccount = resolveReloginTarget(currentAccounts, { accountId: resolvedAccountId, accountName: resolvedAccountName, uin: resolvedUin });
        const scopedAccountId = normalizeText(preMatchedAccount && preMatchedAccount.id) || resolvedAccountId;
        const scopedAccountName = normalizeText(preMatchedAccount && preMatchedAccount.name) || resolvedAccountName;
        const displayName = scopedAccountName || scopedAccountId || resolvedUin || '未知账号';

        if (directTicket) {
            const freshAuthCode = await miniProgramLoginSession.getAuthCode(directTicket, '1112386029');
            if (freshAuthCode) {
                return applyReloginCode({ accountId: scopedAccountId, accountName: scopedAccountName, authCode: freshAuthCode, uin: resolvedUin, platform: resolvedPlatform });
            }
            throw new Error('ticket 存在，但未换取到 authCode');
        }

        if (directAuthCode) {
            return applyReloginCode({ accountId: scopedAccountId, accountName: scopedAccountName, authCode: directAuthCode, uin: resolvedUin, platform: resolvedPlatform });
        }

        const loginCandidate = directLoginCode || rawCode;
        if (loginCandidate && (!resolvedPlatform || resolvedPlatform === 'qq')) {
            try {
                const status = await miniProgramLoginSession.queryStatus(loginCandidate);
                if (status && status.status === 'OK') {
                    const freshUin = normalizeText(status.uin) || resolvedUin;
                    const freshTicket = normalizeText(status.ticket);
                    if (!freshTicket) {
                        throw new Error('loginCode 已确认，但 ticket 为空');
                    }
                    const freshAuthCode = await miniProgramLoginSession.getAuthCode(freshTicket, '1112386029');
                    if (!freshAuthCode) {
                        throw new Error('loginCode 已确认，但未换取到 authCode');
                    }
                    return applyReloginCode({ accountId: scopedAccountId, accountName: scopedAccountName, authCode: freshAuthCode, uin: freshUin, platform: resolvedPlatform || 'qq' });
                }

                if (status && status.status === 'Wait') {
                    startReloginWatcher({
                        loginCode: loginCandidate,
                        accountId: scopedAccountId,
                        accountName: scopedAccountName || displayName,
                    });
                    return {
                        ok: true,
                        mode: 'watching_login_code',
                        accountId: scopedAccountId,
                        accountName: scopedAccountName || displayName,
                    };
                }

                if (status && status.status === 'Used') {
                    log('系统', `[Code接收] loginCode 已失效，尝试直接按 authCode 使用: ${displayName}`, { accountId: scopedAccountId, accountName: scopedAccountName });
                } else if (status && status.status === 'Error') {
                    log('系统', `[Code接收] loginCode 查询未通过，尝试直接按 authCode 使用: ${displayName}`, { accountId: scopedAccountId, accountName: scopedAccountName, error: status.msg || '' });
                }
            } catch (error) {
                const message = error && error.message ? error.message : String(error || 'unknown');
                log('系统', `[Code接收] loginCode 解析失败，回退 direct authCode 模式: ${message}`, { accountId: scopedAccountId, accountName: scopedAccountName });
            }
        }

        const fallbackCode = rawCode || directLoginCode;
        if (fallbackCode) {
            return applyReloginCode({ accountId: scopedAccountId, accountName: scopedAccountName, authCode: fallbackCode, uin: resolvedUin, platform: resolvedPlatform });
        }

        throw new Error('缺少 code');
    }

    async function triggerOfflineReminder(payload = {}) {
        try {
            const cfg = store.getOfflineReminder ? store.getOfflineReminder() : null;
            if (!cfg) return;

            const channelName = String(cfg.channel || '').trim().toLowerCase();
            const reloginUrlMode = String(cfg.reloginUrlMode || 'none').trim().toLowerCase();
            const endpoint = String(cfg.endpoint || '').trim();
            const channel = channelName;
            const token = String(cfg.token || '').trim();
            const baseTitle = String(cfg.title || '').trim();
            const accountName = String(payload.accountName || payload.accountId || '').trim();
            const title = accountName ? `${baseTitle} ${accountName}` : baseTitle;
            let content = String(cfg.msg || '').trim();
            if (!channel || !token || !title || !content) return;
            if (channel === 'webhook' && !endpoint) return;
            if (reloginUrlMode === 'qq_link' || reloginUrlMode === 'qr_code' || reloginUrlMode === 'all') {
                try {
                    const qr = await miniProgramLoginSession.requestLoginCode();
                    const loginCode = String((qr && qr.code) || '').trim();
                    const qqUrl = String((qr && (qr.url || qr.loginUrl)) || '').trim();
                    if (qqUrl) {
                        if (reloginUrlMode === 'qq_link') {
                            content = `${content}\n\n登录链接: ${qqUrl}`;
                        } else if (reloginUrlMode === 'qr_code') {
                            const image = await QRCode.toDataURL(qqUrl, {
                                width: 300,
                                margin: 1,
                                errorCorrectionLevel: 'M',
                            });
                            content = `${content}\n\n登录二维码:\n\n<img src="${image}" alt="登录二维码" width="300" height="300" />`;
                        } else if (reloginUrlMode === 'all') {
                            const image = await QRCode.toDataURL(qqUrl, {
                                width: 300,
                                margin: 1,
                                errorCorrectionLevel: 'M',
                            });
                            content = ` ${content}\n\n登录链接: ${qqUrl}\n登录二维码:\n <img src="${image}" alt="登录二维码" width="300" height="300" />`;
                        }
                    }
                    if (loginCode) {
                        startReloginWatcher({
                            loginCode,
                            accountId: String(payload.accountId || '').trim(),
                            accountName: String(payload.accountName || '').trim(),
                        });
                    }
                } catch (e) {
                    log('错误', `获取重登录链接失败: ${e.message}`);
                }
            }

            const ret = await sendPushooMessage({
                channel,
                endpoint,
                token,
                title,
                content,
            });

            if (ret && ret.ok) {
                const accountName = String(payload.accountName || payload.accountId || '');
                log('系统', `下线提醒发送成功: ${accountName}`);
            } else {
                log('错误', `下线提醒发送失败: ${ret && ret.msg ? ret.msg : 'unknown'}`);
            }
        } catch (e) {
            log('错误', `下线提醒发送异常: ${e.message}`);
        }
    }

    return {
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        startReloginWatcher,
        applyReloginCode,
        handleReceivedCode,
    };
}

module.exports = {
    createReloginReminderService,
};
