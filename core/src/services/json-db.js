const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function readTextFile(filePath, fallback = '') {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return fallback;
    }
}

function readJsonFile(filePath, fallbackFactory = () => ({})) {
    const fallback = typeof fallbackFactory === 'function' ? fallbackFactory() : (fallbackFactory || {});
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeJsonFileAtomic(filePath, data, space = 2) {
    const json = JSON.stringify(data, null, space);
    writeTextFileAtomic(filePath, json);
}

function writeTextFileAtomic(filePath, text = '') {
    const targetDir = ensureParentDir(filePath);
    const tmpPath = path.join(targetDir, `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const content = String(text);

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            ensureParentDir(tmpPath);
            fs.writeFileSync(tmpPath, content, 'utf8');
            fs.renameSync(tmpPath, filePath);
            return;
        } catch (err) {
            const isLastAttempt = attempt >= 1;
            if (!err || err.code !== 'ENOENT' || isLastAttempt) throw err;
            ensureParentDir(filePath);
        } finally {
            try {
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch {
                // ignore cleanup errors
            }
        }
    }
}

module.exports = {
    readTextFile,
    readJsonFile,
    writeTextFileAtomic,
    writeJsonFileAtomic,
};
