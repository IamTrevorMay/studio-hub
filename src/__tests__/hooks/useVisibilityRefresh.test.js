import { renderHook, act } from '@testing-library/react';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';

describe('useVisibilityRefresh', () => {
  let visibilityState;

  beforeAll(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
  });

  beforeEach(() => {
    visibilityState = 'visible';
  });

  it('fires callback on blur then focus', () => {
    const cb = jest.fn();
    renderHook(() => useVisibilityRefresh(cb));

    act(() => { window.dispatchEvent(new Event('blur')); });
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on focus without prior blur', () => {
    const cb = jest.fn();
    renderHook(() => useVisibilityRefresh(cb));

    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(cb).not.toHaveBeenCalled();
  });

  it('fires callback on visibilitychange hidden then visible', () => {
    const cb = jest.fn();
    renderHook(() => useVisibilityRefresh(cb));

    act(() => {
      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires only once for repeated focus after single blur', () => {
    const cb = jest.fn();
    renderHook(() => useVisibilityRefresh(cb));

    act(() => { window.dispatchEvent(new Event('blur')); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cleans up listeners on unmount', () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useVisibilityRefresh(cb));

    unmount();

    act(() => { window.dispatchEvent(new Event('blur')); });
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(cb).not.toHaveBeenCalled();
  });
});
