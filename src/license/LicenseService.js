class LicenseService {
  constructor(options = {}) {
    this.decrypt = options.decrypt || null;
  }

  parseKey(encryptedKey) {
    if (!encryptedKey) {
      return {
        ok: false,
        error: 'license key is empty',
      };
    }

    if (!this.decrypt) {
      return {
        ok: false,
        error: 'license decrypt function is not configured',
      };
    }

    try {
      const decrypted = this.decrypt(encryptedKey);
      const payload = JSON.parse(decrypted);
      return {
        ok: true,
        payload,
        expiresAt: Number(payload.date),
        file: payload.file || null,
        moduleConfig: payload.moduleConfig || null,
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }

  getSelectFlag(licenseFile) {
    if (Array.isArray(licenseFile)) {
      return licenseFile;
    }
    if (licenseFile === 'all') {
      return 'all';
    }
    return licenseFile || null;
  }

  getDefaultFile(licenseFile, fallback = 'hand0205') {
    if (Array.isArray(licenseFile) && licenseFile.length) {
      return licenseFile[0];
    }
    if (licenseFile && licenseFile !== 'all') {
      return licenseFile;
    }
    return fallback;
  }

  isExpired(expiresAt, now = Date.now()) {
    return Number(expiresAt) <= Number(now);
  }
}

module.exports = {
  LicenseService,
};
