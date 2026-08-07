import { describe, expect, it, vi } from 'vitest';

import { handleResizeObserverLoopError } from '../resize-observer-error';

describe('handleResizeObserverLoopError', () => {
  it.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
  ])('should stop the known non-fatal browser event: %s', (message) => {
    const event = new ErrorEvent('error', { message });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopImmediatePropagation = vi.spyOn(
      event,
      'stopImmediatePropagation',
    );

    handleResizeObserverLoopError(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it('should preserve unrelated runtime errors', () => {
    const event = new ErrorEvent('error', { message: 'application failed' });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopImmediatePropagation = vi.spyOn(
      event,
      'stopImmediatePropagation',
    );

    handleResizeObserverLoopError(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
