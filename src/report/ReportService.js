class ReportService {
  constructor({ store, pythonClient } = {}) {
    this.store = store || null;
    this.pythonClient = pythonClient || null;
  }

  setPythonClient(pythonClient) {
    this.pythonClient = pythonClient;
  }

  async getDbHeatmap(options = {}) {
    if (!this.store) {
      throw new Error('store is required');
    }
    if (!this.pythonClient?.call) {
      throw new Error('pythonClient.call is required');
    }

    const frames = this.store.queryFrames(options);
    const sensorData = frames.map((frame) => {
      try {
        return JSON.parse(frame.data_json || '[]');
      } catch {
        return [];
      }
    });

    if (!sensorData.length) {
      return {
        ok: false,
        error: 'no data',
      };
    }

    const result = await this.pythonClient.call('get_peak_frame', {
      sensor_data: sensorData,
    }, {
      timeoutMs: options.timeoutMs || 60000,
    });

    return {
      ok: true,
      data: result,
    };
  }

  async generateFootPressureReport(options = {}) {
    if (!this.pythonClient?.call) {
      throw new Error('pythonClient.call is required');
    }

    const result = await this.pythonClient.call('generate_foot_pressure_report1', {
      sensor_data: options.sensorData || [],
      pdf_name: options.pdfName,
      heatmap_png_path: options.heatmapPngPath,
      user_name: options.userName,
      user_age: options.userAge,
      user_gender: options.userGender,
      user_id: options.userId || 9527,
    }, {
      timeoutMs: options.timeoutMs || 120000,
    });

    return {
      ok: true,
      data: result,
      pdfFilePath: options.pdfName ? `${options.pdfName}.pdf` : undefined,
    };
  }
}

module.exports = {
  ReportService,
};
