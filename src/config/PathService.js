const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizeFilename(name) {
  if (typeof name !== 'string') return '';
  return name
    .trim()
    .replace(/[\\/]/g, '')
    .replace(/[\x00-\x1F<>:"|?*]/g, '')
    .replace(/[.\s]+$/g, '');
}

class PathService {
  constructor(options = {}) {
    this.dbDir = options.dbDir || path.join(process.cwd(), 'db');
    this.exportDir = options.exportDir || path.join(process.cwd(), 'data');
    this.imageDir = options.imageDir || path.join(process.cwd(), 'img');
    this.reportDir = options.reportDir || path.join(process.cwd(), 'pdf');
  }

  ensureRuntimeDirs() {
    return {
      dbDir: ensureDir(this.dbDir),
      exportDir: ensureDir(this.exportDir),
      imageDir: ensureDir(this.imageDir),
      reportDir: ensureDir(this.reportDir),
    };
  }

  validateWritableDirectory(targetDir) {
    if (!targetDir || typeof targetDir !== 'string') {
      return { ok: false, error: 'directory is empty' };
    }

    try {
      ensureDir(targetDir);
      const testFile = path.join(targetDir, `.write-test-${Date.now()}`);
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return { ok: true, dir: targetDir };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  getExportPath(filename, dir = this.exportDir) {
    ensureDir(dir);
    return path.join(dir, sanitizeFilename(filename));
  }
}

module.exports = {
  PathService,
  sanitizeFilename,
};
