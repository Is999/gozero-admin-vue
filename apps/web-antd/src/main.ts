import { initPreferences } from '@vben/preferences';
import { unmountGlobalLoading } from '@vben/utils';

import { overridesPreferences, preferencesExtension } from './preferences';
import { installResizeObserverLoopErrorGuard } from './utils/resize-observer-error';

// 浏览器会把可延迟到下一帧的 ResizeObserver 通知上报为 error；只过滤两种标准文本，保留其它运行期异常。
installResizeObserverLoopErrorGuard();

/**
 * 渲染启动失败兜底页；此时多语言和组件系统可能尚未初始化，因此使用双语静态文案。
 */
function renderStartupError(error: unknown) {
  console.error('[bootstrap] application initialization failed', error);
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;

  const panel = document.createElement('main');
  panel.setAttribute('role', 'alert');
  panel.style.cssText =
    'min-height:100vh;display:grid;place-items:center;padding:24px;background:#0f1115;color:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;';
  panel.innerHTML = `
    <section style="width:min(520px,100%);padding:32px;border:1px solid #2d3440;border-radius:16px;background:#181b21;box-shadow:0 24px 80px rgba(0,0,0,.35)">
      <div style="font-size:14px;font-weight:600;color:#ef4444">APPLICATION STARTUP ERROR</div>
      <h1 style="margin:12px 0 8px;font-size:26px;line-height:1.35">应用启动失败</h1>
      <p style="margin:0;color:#a7adb8;line-height:1.7">初始化未完成，请刷新页面重试；若问题持续，请联系系统管理员。<br />Initialization failed. Refresh the page or contact the administrator.</p>
      <button type="button" style="margin-top:24px;width:100%;height:42px;border:0;border-radius:8px;background:#1677ff;color:#fff;font-weight:600;cursor:pointer">刷新页面 / Refresh</button>
    </section>`;
  panel.querySelector('button')?.addEventListener('click', () => {
    window.location.reload();
  });
  root.replaceChildren(panel);
}

/**
 * 应用初始化完成之后再进行页面加载渲染
 */
async function initApplication() {
  // name用于指定项目唯一标识
  // 用于区分不同项目的偏好设置以及存储数据的key前缀以及其他一些需要隔离的数据
  const env = import.meta.env.PROD ? 'prod' : 'dev';
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const namespace = `${import.meta.env.VITE_APP_NAMESPACE}-${appVersion}-${env}`;

  // app偏好设置初始化
  await initPreferences({
    extension: preferencesExtension,
    namespace,
    overrides: overridesPreferences,
  });

  // 启动应用并挂载
  // vue应用主要逻辑及视图
  const { bootstrap } = await import('./bootstrap');
  await bootstrap(namespace);
}

void initApplication().catch(renderStartupError).finally(unmountGlobalLoading);
