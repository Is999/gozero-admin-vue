// RESIZE_OBSERVER_LOOP_MESSAGES 是浏览器在单帧内无法交付全部尺寸通知时使用的固定非致命错误文本。
const RESIZE_OBSERVER_LOOP_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]);

/**
 * handleResizeObserverLoopError 只拦截浏览器可在下一帧继续交付的 ResizeObserver 循环通知。
 * 其它脚本异常保持原传播路径，继续交给 Vite 错误浮层和生产监控处理。
 */
export function handleResizeObserverLoopError(event: ErrorEvent) {
  if (!RESIZE_OBSERVER_LOOP_MESSAGES.has(String(event.message || '').trim())) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** installResizeObserverLoopErrorGuard 在捕获阶段注册过滤器，先于普通错误监听器处理已知非致命通知。 */
export function installResizeObserverLoopErrorGuard() {
  window.addEventListener('error', handleResizeObserverLoopError, true);
}
