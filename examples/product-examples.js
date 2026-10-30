/**
 * 产品接入示例事实源：生成完整浏览器/Node 示例及已有项目使用的核心片段。
 * 纯源码生成模块，不导入 SDK 运行时、不访问 DOM、不激活许可，不修改全局对象。
 */
const drivers = Object.freeze({
  windows: 'https://shroom.jq-industries.com/drive/CH341SER.EXE',
  macos: 'https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip',
});

/** 校验产品、运行端和平台，统一转换成示例模板使用的协议配置；不探测真实硬件。 */
function normalize(options = {}) {
  const { product, side, env, platform = 'windows', kind = 'complete' } = options;
  if (!['glove', 'pad'].includes(product)) throw new TypeError('请选择触觉手套或手部检测垫。');
  if (product === 'glove' && !['left', 'right'].includes(side)) throw new TypeError('生成手套示例前，请明确选择实物的左右手。');
  if (!['web', 'node'].includes(env)) throw new TypeError('此示例生成器支持浏览器 JavaScript 与 Node.js。');
  if (!['windows', 'macos', 'linux'].includes(platform)) throw new TypeError('请选择 Windows、macOS 或 Linux。');
  if (!['complete', 'snippet'].includes(kind)) throw new TypeError('请选择完整示例或接入片段。');
  return {
    product: product === 'glove' ? 'handGloveFullPacket' : 'hand',
    ...(product === 'glove' ? { side } : {}), env, platform, kind,
    label: product === 'glove' ? (side === 'left' ? '左手' : '右手') + '触觉手套' : '手部检测垫',
    filename: (product === 'glove' ? 'glove-' + side : 'hand-pad') + '-example.' + (env === 'node' ? 'mjs' : 'html'),
  };
}

// 直接保存示例源码，避免网站生产压缩改变函数源码或删除下载内容中的中文注释。
const webRuntimeSource = String.raw`function webRuntime(Shroom, configuration) {
  // 一、连接状态：一个页面只保留一个当前会话，按钮状态由授权、连接和清理进度共同决定。
  // configuration 是文末的产品配置；改接其他实物时，先核对产品协议及手套手侧。
  const $ = (id) => document.getElementById(id);
  // 与同源 SDK 示例共用安装标识，避免同一浏览器打开不同示例时重复占用电脑名额。
  const installationStorageKey = 'shroom-sdk-device-id';
  let installationId;
  let installationError;
  let activeSession = null;
  const closingSessions = new Set();
  let pendingConnections = 0;
  let activating = false;
  let hidden = false;
  let activationRevision = 0; // 识别过期的异步激活，防止旧请求覆盖后来操作或返回后的页面状态。
  let connectionState = '未连接';
  let frames = 0;
  let lastFrameAt = null;
  let lastError = null;
  let lastViewTime = 0;

  // 二、错误与界面：展示可操作的错误信息，诊断仅保留明确允许公开的字段。
  function errorInfo(error) {
    // 不复制密钥、安装标识、请求详情或异常上下文，避免把授权信息带进诊断 JSON。
    return {
      code: String(error?.code || 'APPLICATION_ERROR'),
      stage: String(error?.stage || ''),
      message: String(error?.message || '操作失败。'),
      suggestion: String(error?.suggestion || ''),
    };
  }

  function report(error) {
    lastError = errorInfo(error);
    $('last-error').textContent = [lastError.code, lastError.message, lastError.suggestion].filter(Boolean).join('\n');
  }

  function licenseStatus() {
    try { return Shroom.getLicenseStatus(); }
    catch { return { valid: false, code: 'LICENSE_REQUIRED' }; }
  }

  function refresh() {
    if (hidden) return;
    // 按钮禁用用于防止误操作；真实采集是否获准仍由 SDK 的授权检查决定。
    const licensed = licenseStatus().valid;
    $('connection-state').textContent = connectionState;
    $('frame-count').textContent = String(frames);
    $('last-frame').textContent = lastFrameAt || '尚未收到';
    $('license-state').textContent = activating ? '正在激活…' : licensed ? '授权有效' : '请先激活 SDK 授权';
    $('activate').disabled = activating || Boolean(installationError) || closingSessions.size > 0;
    $('connect').disabled = !licensed || activating || pendingConnections > 0 || Boolean(activeSession) || closingSessions.size > 0;
    $('disconnect').disabled = !activeSession || activating;
  }

  function clearWaitingTimer(session) {
    if (session?.waitingTimer) clearTimeout(session.waitingTimer);
    if (session) session.waitingTimer = null;
  }

  // 三、关闭与竞态：先把会话标记为失效，再等待串口释放，旧回调就不能继续更新页面。
  async function closeSession(session) {
    if (!session) return;
    session.retired = true;
    clearWaitingTimer(session);
    if (activeSession === session) activeSession = null;
    // 串口选择/打开仍可能尚未完成；设备稍后返回时，连接代码会识别失效会话并立即关闭。
    if (!session.device) { refresh(); return; }
    if (!session.closePromise) {
      // 多个错误或操作可能同时要求关闭；共用同一个 Promise，避免重复关闭端口。
      closingSessions.add(session);
      refresh();
      session.closePromise = Promise.resolve().then(() => session.device.close()).catch((error) => {
        report(error);
      }).finally(() => {
        session.device = null;
        closingSessions.delete(session);
        refresh();
      });
    }
    await session.closePromise;
  }

  // 手动断开必须等待 close() 完成，清除旧设备引用后才允许用户重新连接。
  async function disconnect() {
    connectionState = '已断开';
    const session = activeSession;
    await closeSession(session);
    refresh();
  }

  function handleRuntimeError(session, error) {
    if (session.retired || activeSession !== session) return;
    report(error);
    // CALLBACK_FAILED 是应用回调异常，不等于串口掉线；应修复回调，保留仍健康的连接。
    if (error?.code === 'CALLBACK_FAILED') { refresh(); return; }
    connectionState = '已断开';
    $('next-step').textContent = String(error?.code || '').startsWith('LICENSE_')
      ? '采集已停止。重新激活 SDK 授权后，再点击连接设备。'
      : '采集已停止。确认设备、驱动和端口状态，再点击连接设备。';
    void closeSession(session);
    refresh();
  }

  // 四、onData 数据：每次收到的是 SDK 已完成分帧和产品映射的一帧，不要再按串口包解码。
  function showFrame(session, data) {
    if (session.retired || activeSession !== session) return;
    clearWaitingTimer(session);
    frames += 1;
    lastFrameAt = new Date().toISOString(); // 页面接收时间，不是设备采样时钟或实时采样率。
    connectionState = '正在取数';
    const now = Date.now();
    // 每帧都计数，只限制屏幕刷新频率，避免大量 DOM/JSON 更新拖慢串口处理。
    if (frames !== 1 && now - lastViewTime < 100) return;
    lastViewTime = now;
    // pressure：原始扫描顺序的 ADC（0～255）；pressureMatrix：映射后的 ADC，一维按行展开。
    // values 是同一映射的 0～1 相对值。上述字段都不是 Pa/N，物理单位需按实际硬件标定。
    const raw = Array.from(data.pressure || []);
    const matrix = Array.from(data.pressureMatrix || []);
    let peakIndex = 0;
    for (let i = 1; i < matrix.length; i += 1) if (matrix[i] > matrix[peakIndex]) peakIndex = i;
    const sample = {
      product: data.product,
      ...(configuration.side ? { side: data.side } : {}),
      rawADCFirst16: raw.slice(0, 16),
      ...(configuration.side ? {
        // 手套：五指 raw 是主体点，pulp.raw 是独立指腹点；不要把指腹混入主体点序号。
        fingersADC: Object.fromEntries(Object.entries(data.fingers || {}).map(([name, region]) => [name, {
          body: Array.from(region.raw || []), pulp: Array.from(region.pulp?.raw || []),
        }])),
        // 手掌 matrix 共 72 点，首行 12 点，其余四行各 15 点，不能假定为等宽矩阵。
        palmADC: Array.from(data.palm?.matrix || [], (row) => Array.from(row)),
      } : {
        // 手垫：展示完整 32×32 映射；峰值仅作辅助，弱于已有峰值的新触点也要核对其行列。
        peakMatrixPoint: matrix.length ? { row: Math.floor(peakIndex / 32), column: peakIndex % 32, adc: matrix[peakIndex] } : null,
        pressureMatrixADC: Array.from({ length: 32 }, (_, row) => matrix.slice(row * 32, (row + 1) * 32)),
      }),
    };
    // 只压缩数字行的显示格式，保留完整数据，让每个触点都能逐行验收。
    $('data').textContent = JSON.stringify(sample, null, 2).replace(/\[\n((?:\s+\d+,?\n)+)\s*\]/g, (_match, values) => '[' + values.trim().split(/,\s*/).join(', ') + ']');
    $('next-step').textContent = configuration.side
      ? '已收到首帧。完整五指（含指腹）与 72 点手掌矩阵见下方；逐一触按已知位置，确认分区变化，若不对应请核对实物手侧。'
      : '已收到首帧。完整 32 × 32 ADC 矩阵见下方；分别触按已知位置，比较对应行列变化，行列索引从 0 开始。峰值仅用于辅助定位。';
    refresh();
  }

  // 五、稳定安装标识：只生成一次并保存到当前来源的 localStorage，不保存密钥。
  // 这用于电脑名额登记，并非硬件身份凭证；换来源/浏览器或清除存储前需先处理名额。
  try {
    installationId = localStorage.getItem(installationStorageKey);
    if (!/^[a-f0-9]{64}$/.test(installationId || '')) {
      installationId = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(installationStorageKey, installationId);
      if (localStorage.getItem(installationStorageKey) !== installationId) throw new Error('安装标识保存失败。');
    }
    $('installation-state').textContent = '安装标识已自动保存到当前浏览器，无需手动填写。换浏览器或清除站点数据前，请先处理电脑名额。';
  } catch {
    installationError = { code: 'INSTALLATION_STORAGE_UNAVAILABLE', message: '无法持久保存安装标识。请允许当前站点存储，刷新后再激活，避免重复占用电脑名额。' };
    report(installationError);
    $('installation-state').textContent = installationError.message;
  }

  // 六、独立激活：网络授权可能耗时，先激活再点击连接，避免丢失串口选择所需的用户手势。
  $('activate').onclick = async () => {
    if (activating || installationError || hidden) return;
    activating = true;
    const revision = ++activationRevision;
    const key = $('key').value.trim();
    const mode = $('license-mode').value;
    connectionState = activeSession ? '已断开' : connectionState;
    const previousSession = activeSession;
    refresh();
    try {
      // 换密钥前先关闭旧会话；清空旧授权，防止新密钥输入失败后仍误用原授权。
      await closeSession(previousSession);
      if (hidden || revision !== activationRevision) return;
      Shroom.clearLicense();
      // deviceId 来自上面的持久标识。offline 表示 RSA 码格式；限定电脑名额的离线码仍需联网复核。
      // 未传 publicKey 时使用 SDK 默认信任公钥，不能从不可信授权码中接受一个新公钥。
      await Shroom.activateLicense(key, { deviceId: installationId, mode });
      if (hidden || revision !== activationRevision) return;
      lastError = null;
      $('last-error').textContent = '无';
      $('next-step').textContent = '授权已激活。请点击连接设备，并选择实物对应的串口。';
    } catch (error) {
      if (!hidden && revision === activationRevision) {
        report(error);
        $('next-step').textContent = '核对 SDK 产品密钥、有效期、电脑名额与网络，再重新激活。';
      }
    } finally {
      // 只让当前请求收尾；从页面缓存返回后，旧请求不能清空用户刚输入的新密钥。
      if (revision === activationRevision) {
        $('key').value = '';
        activating = false;
      }
      refresh();
    }
  };

  // 七、连接设备：产品入口内置波特率、分帧和映射；不要额外覆盖这些协议参数。
  $('connect').onclick = async () => {
    if ($('connect').disabled || hidden) return;
    const session = { device: null, retired: false, closePromise: null, waitingTimer: null };
    activeSession = session;
    pendingConnections += 1;
    frames = 0;
    lastFrameAt = null;
    lastError = null;
    $('last-error').textContent = '无';
    $('data').textContent = '等待设备输出有效帧…';
    connectionState = '连接中';
    refresh();
    try {
      // 在点击中直接调用 connectProduct，前面不能先 await 远程激活或其他异步工作。
      // 浏览器由用户选择实际串口，不传 Node 的 path；串口列表也不会识别产品型号。
      session.device = await Shroom.connectProduct({
        // product 必须与实物协议一致：handGloveFullPacket 为整包手套，hand 为手部检测垫。
        product: configuration.product,
        // side 仅手套需要，来自实物左右手选择，SDK 不会从串口或包类型猜测。
        ...(configuration.side ? { side: configuration.side } : {}),
        // onData 在收到有效帧时调用；这里统一处理真实字段、计数和触点验收。
        onData: (data) => showFrame(session, data),
        // onError 接收连接后的拔线、读取、授权失效及应用回调错误，连接前失败由 catch 处理。
        onError: (error) => handleRuntimeError(session, error),
      });
      // 等待串口打开时用户可能已断开、换密钥或离开页面，迟到的设备不能成为新会话。
      if (session.retired || hidden || activeSession !== session) { await closeSession(session); return; }
      if (session.device.state && session.device.state !== 'open') {
        handleRuntimeError(session, { code: 'DISCONNECTED', message: '设备在连接完成前已关闭，请确认连接后重试。' });
        return;
      }
      // 端口打开不等于收到有效数据；首帧可能已在 connectProduct 返回前进入 onData。
      connectionState = frames ? '正在取数' : '等待首帧';
      if (!frames) {
        $('next-step').textContent = '端口已打开，等待有效帧；这还不代表产品与触点映射已经验证。';
        session.waitingTimer = setTimeout(() => {
          if (activeSession !== session || session.retired || frames) return;
          $('next-step').textContent = '仍未收到有效帧。确认设备正在输出当前产品协议；也可断开后核对产品、供电与端口。';
        }, 10000);
      }
    } catch (error) {
      // 包括取消串口选择、驱动/占用、配置和授权错误；先清理再允许手动重试，不自动重连。
      if (!session.retired && !hidden) {
        report(error);
        connectionState = '已断开';
        $('next-step').textContent = '确认驱动、端口和 SDK 授权后，点击连接设备重试。';
      }
      await closeSession(session);
    } finally {
      pendingConnections -= 1;
      refresh();
    }
  };

  $('disconnect').onclick = disconnect;
  // 八、支持诊断：只复制状态和计数，不复制密钥、安装标识或串口请求详情。
  $('copy-diagnostics').onclick = async () => {
    let source;
    try { source = activeSession?.device?.getDiagnostics(); } catch { /* 诊断失败不能影响正在进行的采集。 */ }
    const license = licenseStatus();
    const diagnostic = {
      product: configuration.product,
      ...(configuration.side ? { side: configuration.side } : {}),
      runtime: 'web', sdkVersion: Shroom.version,
      connectionState, frameCount: frames, lastFrameAt, lastError,
      license: { valid: Boolean(license.valid), ...(license.valid ? { mode: license.mode, expiresAt: license.expiresAt } : { code: license.code }) },
      ...(source ? { serial: {
        source: source.source, state: source.state, status: source.status,
        bytesReceived: source.bytesReceived, frameCount: source.frameCount,
        droppedCount: source.droppedCount, frameLength: source.frameLength,
      } } : {}),
    };
    const text = JSON.stringify(diagnostic, null, 2);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      $('diagnostic-status').textContent = '诊断信息已复制，不含密钥或安装标识。';
    } catch {
      $('diagnostics').hidden = false;
      $('diagnostics').textContent = text;
      $('diagnostic-status').textContent = '浏览器未允许复制，请手动复制下面的诊断 JSON。';
    }
  };
  // 九、页面生命周期：离开时清理设备与许可；即使页面进入浏览器往返缓存，也不保留采集。
  window.addEventListener('pagehide', () => {
    hidden = true;
    activationRevision += 1;
    $('key').value = '';
    void closeSession(activeSession);
    Shroom.clearLicense();
  });
  window.addEventListener('pageshow', () => {
    if (!hidden) return;
    // 从往返缓存恢复时重置界面，要求重新激活并手动连接；不自动重连或重放任何命令。
    hidden = false;
    activating = false;
    Shroom.clearLicense();
    connectionState = '已断开';
    frames = 0;
    lastFrameAt = null;
    lastViewTime = 0;
    $('key').value = '';
    $('data').textContent = '页面已恢复，尚未连接设备。';
    $('next-step').textContent = '页面已恢复。请重新激活 SDK 授权，再点击连接设备；上一次采集会话已关闭，不会自动恢复。';
    refresh();
  });
  refresh();
}`;

const nodeRuntimeSource = String.raw`async function nodeRuntime(Shroom, activateLicenseFromEnv, configuration) {
  // 一、实际端口：取命令行第二个参数，不默认猜 COM 号或 /dev 路径，避免连到其他设备。
  // 配置中的 product/side 已来自实物选择；串口路径只决定连接位置，不会自动识别型号和手侧。
  const path = process.argv[2];
  if (!path) {
    const example = configuration.platform === 'windows' ? 'COM7' : configuration.platform === 'macos' ? '/dev/cu.usbserial-设备标识' : '/dev/ttyUSB0';
    console.error('请传入系统中实际识别到的串口路径；下列路径仅为格式示意。');
    console.error('用法：node ' + configuration.filename + ' <串口路径>\n示例：node ' + configuration.filename + ' ' + example);
    console.error(configuration.platform === 'windows'
      ? '先安装 CH34x Windows 驱动，在设备管理器中确认 COM 端口。'
      : configuration.platform === 'macos' ? '先安装 CH34x macOS 驱动，可用 ls /dev/cu.* 检查设备端口。' : '请确认系统识别串口及当前用户具有串口访问权限。');
    process.exitCode = 1;
    return;
  }
  let device;
  let stopping = false;
  let closePromise;
  let frameCount = 0;
  let lastLogAt = 0;
  // 二、错误与资源：只记录错误码、说明和下一步建议，不打印密钥或请求详情。
  function report(error) {
    console.error(JSON.stringify({ code: error?.code || 'APPLICATION_ERROR', message: error?.message || '操作失败。', suggestion: error?.suggestion || '' }));
  }
  async function stop(reason) {
    // 先停止接收应用数据，再等待端口释放；同一关闭 Promise 可安全合并错误与 Ctrl+C。
    stopping = true;
    if (!device) return; // 端口仍在打开时先标记停止，设备一旦返回就会被下方代码关闭。
    if (!closePromise) {
      closePromise = Promise.resolve().then(() => device.close()).catch((error) => { report(error); process.exitCode = 1; }).finally(() => {
        device = null;
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        console.log('已断开：' + reason + '；累计有效帧 ' + frameCount);
      });
    }
    await closePromise;
  }
  const onSignal = () => { void stop('手动停止'); };
  try {
    // 三、授权：辅助函数从 SHROOM_LICENSE_KEY / SHROOM_LICENSE_FILE 读取密钥。
    // 默认把稳定安装标识保存在用户目录 .shroom-sdk/device-id，重启后复用，避免新增电脑登记。
    // 只保存安装标识，不保存密钥；产品许可不限制型号，仍需满足期限、电脑名额和功能要求。
    console.log('正在激活 SDK 授权（安装标识由 license-env.js 自动保存）…');
    await activateLicenseFromEnv();
    // 注册退出清理后再打开硬件，让 Ctrl+C / 终止信号都通过相同的异步 close() 释放串口。
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    console.log('连接中：' + path);
    // 四、connectProduct：SDK 已内置产品的波特率、分帧和映射，不要再次传入协议参数。
    device = await Shroom.connectProduct({
      // handGloveFullPacket 使用整包手套协议；hand 使用手部检测垫协议，不能用显示名代替。
      product: configuration.product,
      // side 只给手套使用，必须与实物左右手对应；path 使用上面传入的实际系统串口路径。
      ...(configuration.side ? { side: configuration.side } : {}), path,
      // 五、onData：这里拿到已解析的一帧产品数据，不是原始串口字节。
      onData(data) {
        if (stopping) return;
        frameCount += 1;
        if (frameCount === 1) console.log('已收到首帧。请触按已知位置，核对实物手侧与分区/矩阵响应。ADC 为原始值，不是物理压力单位。');
        // 每帧都计数，只把终端日志限制为每 500 ms 一次；这不是设备采样率设置。
        if (frameCount !== 1 && Date.now() - lastLogAt < 500) return;
        lastLogAt = Date.now();
        // pressure 是原始扫描顺序 ADC（0～255）；pressureMatrix 是映射后按行展开的 ADC。
        // values 为同一映射的 0～1 相对值。都不是 Pa/N，物理单位需要实际硬件标定。
        const matrix = Array.from(data.pressureMatrix || []);
        console.log(JSON.stringify({
          state: '正在取数', frameCount, product: data.product,
          ...(configuration.side ? {
            side: data.side,
            // 五指各自的 raw 是主体点，pulp.raw 是独立指腹点；保留全部点用于逐一触按验收。
            fingersADC: Object.fromEntries(Object.entries(data.fingers || {}).map(([name, region]) => [name, {
              body: Array.from(region.raw || []), pulp: Array.from(region.pulp?.raw || []),
            }])),
            // 手掌共 72 点，matrix 首行 12 点、其余四行各 15 点，不能截成固定宽度矩形。
            palmADC: Array.from(data.palm?.matrix || [], (row) => Array.from(row)),
          } : {
            // 手垫保留完整 32×32 映射，不能只看峰值或第一行，否则无法验证其他位置的触点。
            pressureMatrixADC: Array.from({ length: 32 }, (_, row) => matrix.slice(row * 32, (row + 1) * 32)),
          }),
          rawADCFirst16: Array.from(data.pressure || []).slice(0, 16),
        }));
      },
      // 六、onError：运行期错误从这里处理；激活和打开失败则进入外层 catch。
      onError(error) {
        report(error);
        // CALLBACK_FAILED 是应用回调异常，不代表串口已断开；检查回调代码，保留健康连接。
        if (error?.code === 'CALLBACK_FAILED') return;
        // 拔线、读取或授权失效后停止并释放资源，修复原因后由用户手动重启，不自动重连。
        process.exitCode = 1;
        void stop('设备或授权运行期错误；请处理错误后手动重启示例');
      },
    });
    // 打开期间可能已经收到停止信号或运行期错误，迟到的设备也必须关闭，不能继续取数。
    if (stopping || (device.state && device.state !== 'open')) {
      await stop('设备在连接完成前已关闭');
      return;
    }
    console.log(frameCount ? '正在取数；按 Ctrl+C 断开。' : '等待首帧；端口已打开，按 Ctrl+C 断开。');
  } catch (error) {
    // 连接前失败同样走清理流程；设置退出码而非立即 process.exit，让异步端口关闭能够完成。
    report(error);
    process.exitCode = 1;
    await stop('连接或激活失败');
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}`;

/** 生成带缩进的产品/手侧字段；注释随示例源码一起交付给调用方。 */
function connectionFields(configuration, indent) {
  return indent + '// product 选择实物协议；SDK 已内置波特率、分帧和映射，不要重复覆盖。\n'
    + indent + "product: '" + configuration.product + "',\n"
    + (configuration.side ? indent + '// side 由实物左右手决定，串口与包类型不会自动识别手侧。\n' + indent + "side: '" + configuration.side + "',\n"
      : indent + '// 手部检测垫不使用手侧参数，直接按内置 32×32 点位映射取数。\n');
}

/** 供已授权项目粘贴的调用片段，不包含独立页面与首次激活界面。 */
function snippet(configuration) {
  const fields = connectionFields(configuration, '    ');
  const callback = configuration.side ? 'console.log(data.fingers.thumb.raw, data.palm.matrix)' : 'console.log(data.pressureMatrix, data.values)';
  if (configuration.env === 'node') return [
    '// 用途：把已授权的产品采集接入已有 Node.js 项目；这是核心片段，不含首次运行的完整流程。',
    '// 前提：安装对应驱动并确认串口、在 SDK 根目录 npm install、已完成 SDK 产品授权。',
    '// 导入 Node.js 入口，不能改用浏览器入口；路径相对于当前示例文件。',
    "import { Shroom } from './node/index.js';", '',
    '// 授权须使用稳定安装标识，不能每次启动都随机更换；完整示例的 license-env.js 会自动保存。',
    '// 将 path 预先设为系统中的真实端口路径（Windows 的 COM 号、macOS 的 /dev/cu.* 等）。',
    '// connectProduct 返回可订阅、可关闭的设备；连接前配置/授权/打开失败会拒绝此 Promise。',
    'const device = await Shroom.connectProduct({', fields.trimEnd(),
    '    // 实际端口由项目配置提供，不把格式示例当作固定默认值。', '    path,',
    '    // onData 接收 SDK 已解析且完成映射的一帧，不需要再次按串口协议解码。',
    configuration.side
      ? '    // fingers.thumb.raw 是拇指主体 ADC；指腹另见 pulp.raw；palm.matrix 是完整 72 点手掌。'
      : '    // pressureMatrix 是按行展开的 32×32 ADC；values 是对应的 0～1 相对值。',
    '    // ADC（0～255）及相对值都不是 Pa/N；物理压力/力需要按实际硬件标定。',
    '    onData: data => ' + callback + ',',
    '    // onError 接收连接后的拔线、读取、授权及回调错误；这里仅示意记录，需交给项目清理流程。',
    "    onError: error => console.error(error.code, error.message),", '});',
    '// 连接前失败请由调用方 try/catch；回调中避免重计算或让异常逃逸。',
    '// 运行期致命错误后应 await device.close()，清除引用，再由用户决定是否重连。',
    '// CALLBACK_FAILED 表示应用回调失败，不代表串口断开；不要据此盲目重连。',
    '// 在项目停止或 SIGINT/SIGTERM 时也执行相同清理，等待串口释放后再退出。', '',
  ].join('\n');
  return [
    '// 用途：把产品采集接入已有网页；这是核心片段，不包含授权表单、布局和完整连接状态管理。',
    '// 前提：安装对应驱动、浏览器支持 Web Serial、页面通过 localhost/HTTPS 打开且已有 #connect 按钮。',
    '// 导入浏览器入口；文件放在 SDK 根目录时使用此路径，不能直接通过 file:// 加载模块。',
    "import { Shroom } from './web/index.js';", '',
    '// 前提：已在独立操作中 await Shroom.activateLicense(key, { deviceId }) 完成 SDK 产品授权。',
    '// deviceId 必须是持久安装标识，不要每次随机生成；完整示例会自动保存，且不持久保存密钥。',
    '// 串口选择需要当前点击的用户手势，不要在连接按钮里先 await 远程激活。',
    "document.querySelector('#connect').onclick = async () => {", '  try {',
    '    // connectProduct 内置产品协议与映射；浏览器会让用户选择实际串口，不传 Node 的 path。',
    '    const device = await Shroom.connectProduct({', connectionFields(configuration, '      ').trimEnd(),
    '      // onData 是一帧已解析产品数据；这里只演示字段读取，把展示交给已有页面。',
    configuration.side
      ? '      // fingers.thumb.raw 为拇指主体 ADC，pulp.raw 为独立指腹；palm.matrix 保留完整 72 点手掌。'
      : '      // pressureMatrix 为按行展开的 32×32 ADC；values 为对应的 0～1 相对值。',
    '      // ADC（0～255）和相对值不是 Pa/N；物理单位需要针对实际硬件标定。',
    '      onData: data => ' + callback + ',',
    '      // onError 处理连接后的设备/授权错误；这里仅示意记录，项目还需安排关闭和状态恢复。',
    '      onError: error => console.error(error.code, error.message),', '    });',
    '    // 将 device 交给项目的会话状态持有，避免多次点击产生多个连接。',
    '    console.log(device.info);',
    '    // 结束使用时 await device.close() 并清除引用，串口释放后才允许用户手动重新连接。',
    '    // pagehide/路由离开时清理；pageshow 从往返缓存返回时恢复控件，不能继续使用旧设备。',
    '    // CALLBACK_FAILED 是应用回调错误，不等于掉线；不要因此自动重连或重放命令。',
    '  // 连接前的取消、驱动/占用、配置和授权错误在这里捕获；运行期错误使用上面的 onError。',
    '  } catch (error) { console.error(error.code, error.message); }', '};', '',
  ].join('\n');
}

/** 将固定浏览器运行逻辑与产品配置组装成 HTML；模板内的中文注释保留在产物中。 */
function completeWeb(configuration) {
  return `<!doctype html>
<!-- 用途：首次运行的完整浏览器产品取数示例；按驱动准备、激活授权、连接验收的顺序使用。 -->
<!-- 前置条件：安装对应驱动，使用支持 Web Serial 的浏览器，通过 localhost/HTTPS 运行。 -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${configuration.label} · 首次取数</title>
<!-- 页面样式只负责示例布局和状态反馈，不影响 SDK 协议、解析或采样。 -->
<style>
:root{color-scheme:light;font:16px/1.6 system-ui,sans-serif;color:#17243b;background:#f5f7fa}*{box-sizing:border-box}body{max-width:900px;margin:32px auto;padding:0 20px}h1{font-size:28px;margin-bottom:8px}h2{font-size:19px;margin-top:0}p{margin:8px 0 16px}section{background:white;border:1px solid #d8e0ec;border-radius:12px;padding:22px;margin:18px 0}a{color:#144c9e;text-underline-offset:3px}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #6399ef;outline-offset:3px}label{display:block;font-weight:600;margin-top:12px}input,select,textarea,button{font:inherit}textarea,select{padding:10px;border:1px solid #aebbd0;border-radius:6px;max-width:100%}textarea{display:block;width:100%;min-height:88px}button{padding:10px 16px;min-height:44px;border-radius:6px;background:#184b8d;color:white;border:1px solid #184b8d;cursor:pointer}button.secondary{background:white;color:#184b8d}button:disabled{cursor:default;background:#e5eaf2;color:#536176;border-color:#d5ddea}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.note{font-size:14px;color:#495b72}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.stats dt{font-size:14px;color:#495b72}.stats dd{margin:4px 0 0;font-weight:600;overflow-wrap:anywhere}pre{background:#f3f6fa;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;border-radius:6px}#last-error{color:#9b272d}#next-step{min-height:2em}@media(max-width:560px){body{margin-top:20px}.stats{grid-template-columns:1fr}section{padding:16px}}
</style>
</head>
<body>
<h1>${configuration.label} · 首次取数</h1>
<p>将 <code>${configuration.filename}</code> 放在解压后的 SDK 根目录，与 <code>web/</code> 同级。执行 <code>node start.mjs --no-open</code>，打开 <code>http://localhost:5178/${configuration.filename}</code>；若终端显示了其他端口，请替换地址中的端口。使用支持 Web Serial 的浏览器，通过 localhost 或 HTTPS 访问。</p>
<p class="note">当前示例使用 ${configuration.platform === 'windows' ? 'Windows' : configuration.platform === 'macos' ? 'macOS' : 'Linux'} 的驱动与端口提示；其他系统可在产品接入页面选择实际系统后重新生成。</p>
<!-- 准备区：系统先识别串口，SDK 才能选择和打开设备；串口可见并不代表型号已识别。 -->
<section aria-labelledby="prepare-title">
<h2 id="prepare-title">1. 安装驱动，确认系统串口</h2>
<p><strong>CH34x 设备未安装驱动时，系统可能无法识别串口。</strong>先安装对应驱动，重新插拔设备，再核对系统中的端口。</p>
<p><a href="${drivers.windows}">Windows 驱动（EXE）</a> · <a href="${drivers.macos}">macOS 驱动（ZIP）</a></p>
<p class="note">${configuration.platform === 'windows' ? 'Windows：在设备管理器的“端口（COM 和 LPT）”中确认设备。' : configuration.platform === 'macos' ? 'macOS：在终端运行 ls /dev/cu.*，比较插拔前后的设备端口。' : 'Linux：确认 /dev/ttyUSB* 或对应串口设备存在，且当前用户具有访问权限。Windows/macOS 驱动不适用于 Linux。'} 关闭占用端口的上位机或其他采集程序。</p>
<p class="note">当前示例配置：<strong>${configuration.label}</strong>。这来自你选择的配置，尚未识别实物；${configuration.side ? '请核对左右手，手侧错误仍可能收到数据。' : '请确认实物使用手部检测垫协议。'}</p>
</section>
<!-- 授权区：独立点击激活，不把远程激活和串口选择塞进同一次点击流程。 -->
<section aria-labelledby="license-title">
<h2 id="license-title">2. 激活 SDK 授权</h2>
<p>SDK 使用独立产品密钥，许可不限制传感器型号；仍需满足有效期、电脑名额与已适配的硬件协议。离线码使用 SDK 默认信任的公钥验证。</p>
<label for="license-mode">密钥类型</label><select id="license-mode"><option value="online">在线密钥</option><option value="offline">离线授权码</option></select>
<label for="key">SDK 密钥</label><textarea id="key" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="粘贴 Shroom SDK 产品密钥"></textarea>
<p id="installation-state" class="note"></p>
<p class="note">示例不持久保存密钥，激活完成后会清空输入框。名额已满、换机或密钥未获取时，请联系发放密钥的管理员。</p>
<div class="actions"><button id="activate" type="button">激活授权</button><span id="license-state" role="status">请先激活 SDK 授权</span></div>
</section>
<!-- 采集与验收区：区分端口打开、首帧到达和触点映射验证，错误信息可供辅助技术读取。 -->
<section aria-labelledby="connect-title">
<h2 id="connect-title">3. 连接并验证触点</h2>
<p>授权成功后单独点击连接，以保留串口选择所需的用户手势。示例不会自动重连。</p>
<div class="actions"><button id="connect" type="button" disabled>连接设备</button><button id="disconnect" class="secondary" type="button" disabled>断开</button></div>
<dl class="stats"><div><dt>连接状态</dt><dd id="connection-state" role="status">未连接</dd></div><div><dt>有效帧数</dt><dd id="frame-count">0</dd></div><div><dt>最后一帧</dt><dd id="last-frame">尚未收到</dd></div></dl>
<p id="next-step" role="status">先确认驱动与串口，再激活授权。</p>
<p class="note">ADC 是原始相对读数，不是 Pa / N。收到首帧后，仍需触按已知位置验证映射；物理单位需要针对实际硬件标定。</p>
<pre id="data">尚未收到数据。</pre>
<h2>最后错误</h2><pre id="last-error" role="alert">无</pre>
<div class="actions"><button id="copy-diagnostics" class="secondary" type="button">复制无密钥诊断 JSON</button></div><p id="diagnostic-status" class="note" role="status"></p><pre id="diagnostics" hidden></pre>
</section>
<!-- 模块区：下方代码管理授权、单个设备会话、数据显示、错误恢复及页面生命周期。 -->
<script type="module">
// SDK 导入：这是浏览器入口，路径相对本 HTML；不要直接通过 file:// 打开模块。
import { Shroom } from './web/index.js';
// 当前产品配置：${configuration.product}，${configuration.side ? '实物手侧为 ' + (configuration.side === 'left' ? '左手（left）' : '右手（right）') + '；手侧会影响点位映射。' : '手部检测垫使用内置 32×32 映射，不传手侧参数。'}
// 此配置只声明应用要使用的协议和映射，不表示 SDK 已自动识别实物。
(${webRuntimeSource})(Shroom, ${JSON.stringify(configuration)});
</script>
</body>
</html>
`;
}

/** 生成放在 SDK 根目录的 Node 模块，复用授权辅助和串口/产品入口。 */
function completeNode(configuration) {
  return [
    '// 用途：首次运行的完整 Node.js 产品取数示例，包含授权、首帧验收、运行期错误及端口清理。',
    '// 前置条件：驱动已安装、系统识别到串口；把本文件放在 SDK 根目录，与 node/ 同级，先 npm install。',
    '// SDK 导入：Node.js 入口提供本机串口能力；license-env.js 负责安全读取授权输入和稳定安装标识。',
    "import { Shroom } from './node/index.js';",
    "import { activateLicenseFromEnv } from './node/license-env.js';", '',
    '// 用 SHROOM_LICENSE_KEY 或 SHROOM_LICENSE_FILE 提供密钥；不把密钥写进本文件。',
    '// license-env.js 自动生成并保存稳定安装标识，无需手动填写 SHROOM_DEVICE_ID。',
    '// 在线密钥为默认模式；离线码设置 SHROOM_LICENSE_MODE=offline，信任 SDK 默认公钥。',
    '// 限定电脑名额的离线码仍需联网登记与复核，离线码格式不等于无限制离线运行。',
    '// 使用：node ' + configuration.filename + ' <系统中实际识别到的串口路径>。按 Ctrl+C 释放端口。',
    '// SDK 授权不限制设备型号；产品协议与左右手仍需与实物对应。',
    '// 当前示例使用 ' + (configuration.platform === 'windows' ? 'Windows' : configuration.platform === 'macos' ? 'macOS' : 'Linux') + ' 端口提示；macOS/Linux 等其他系统可在产品接入页面选择实际系统后重新生成。',
    '// 当前产品配置：' + configuration.product + '；' + (configuration.side ? '手侧为 ' + (configuration.side === 'left' ? '左手（left）' : '右手（right）') + '，由实物选择，不由串口自动识别。' : '手部检测垫使用 32×32 映射，不传手侧参数。'), '',
    'await (' + nodeRuntimeSource + ')(Shroom, activateLicenseFromEnv, ' + JSON.stringify(configuration) + ');', '',
  ].join('\n');
}

/** 生成产品示例源码。手套必须明确指定实物手侧；浏览器和 Node 使用各自入口。 */
export function createProductExample(options) {
  const configuration = normalize(options);
  return configuration.kind === 'snippet' ? snippet(configuration)
    : configuration.env === 'web' ? completeWeb(configuration) : completeNode(configuration);
}

/** 返回示例在 SDK 根目录中的文件名，和 createProductExample 使用同一套参数校验。 */
export function getProductExampleFilename(options) {
  return normalize(options).filename;
}
