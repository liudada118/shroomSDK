// 用途：首次运行的完整 Node.js 产品取数示例，包含授权、首帧验收、运行期错误及端口清理。
// 前置条件：驱动已安装、系统识别到串口；把本文件放在 SDK 根目录，与 node/ 同级，先 npm install。
// SDK 导入：Node.js 入口提供本机串口能力；license-env.js 负责安全读取授权输入和稳定安装标识。
import { Shroom } from './node/index.js';
import { activateLicenseFromEnv } from './node/license-env.js';

// 用 SHROOM_LICENSE_KEY 或 SHROOM_LICENSE_FILE 提供密钥；不把密钥写进本文件。
// license-env.js 自动生成并保存稳定安装标识，无需手动填写 SHROOM_DEVICE_ID。
// 在线密钥为默认模式；离线码设置 SHROOM_LICENSE_MODE=offline，信任 SDK 默认公钥。
// 限定电脑名额的离线码仍需联网登记与复核，离线码格式不等于无限制离线运行。
// 使用：node glove-right-example.mjs <系统中实际识别到的串口路径>。按 Ctrl+C 释放端口。
// SDK 授权不限制设备型号；产品协议与左右手仍需与实物对应。
// 当前示例使用 Windows 端口提示；macOS/Linux 等其他系统可在产品接入页面选择实际系统后重新生成。
// 当前产品配置：handGloveFullPacket；手侧为 右手（right），由实物选择，不由串口自动识别。

await (async function nodeRuntime(Shroom, activateLicenseFromEnv, configuration) {
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
})(Shroom, activateLicenseFromEnv, {"product":"handGloveFullPacket","side":"right","env":"node","platform":"windows","kind":"complete","label":"右手触觉手套","filename":"glove-right-example.mjs"});
