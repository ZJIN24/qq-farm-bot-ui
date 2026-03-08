const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const isPackaged = !!process.pkg;

function getResourceRoot() {
    return path.join(__dirname, '..');
}

function getResourcePath(...segments) {
    return path.join(getResourceRoot(), ...segments);
}

function getAppRootForWritable() {
    return isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '../..');
}

function getDataDir() {
    return path.join(getAppRootForWritable(), 'data');
}

function ensureDataDir() {
    const dir = getDataDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function checkDataDirWritable() {
    const dir = ensureDataDir();
    const probeFile = path.join(dir, `.write-test-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);
    return dir;
}

function getDataFile(filename) {
    return path.join(getDataDir(), filename);
}

function getShareFilePath() {
    return path.join(getAppRootForWritable(), 'share.txt');
}

module.exports = {
    isPackaged,
    getResourcePath,
    getDataDir,
    getDataFile,
    ensureDataDir,
    checkDataDirWritable,
    getShareFilePath,
};
