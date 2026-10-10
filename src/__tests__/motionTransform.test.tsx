// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * Behavior test for `useMotionTransform` (qodo #5 on PR #667: the static
 * source scan in tests/motion-invariants proves every Framer transform string
 * goes THROUGH the hook, but nothing exercised the hook itself).
 *
 * The contract: `tx()` returns the transform untouched when the user has no
 * reduced-motion preference, and 'none' when they do — keeping the opacity
 * fade and dropping the movement. `reduce` is a plain boolean either way
 * (framer's hook can return null before hydration).
 */
const reducedMotion = vi.fn<() => boolean | null>(() => false);
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotion(),
}));

import { useMotionTransform } from '../components/ui/motion';

describe('useMotionTransform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reducedMotion.mockReturnValue(false);
  });

  it('passes the transform through when motion is not reduced', () => {
    const { result } = renderHook(() => useMotionTransform());
    expect(result.current.reduce).toBe(false);
    expect(result.current.tx('translateY(16px)')).toBe('translateY(16px)');
    expect(result.current.tx('scale(0.95)')).toBe('scale(0.95)');
  });

  it("returns 'none' for every transform when the user prefers reduced motion", () => {
    reducedMotion.mockReturnValue(true);
    const { result } = renderHook(() => useMotionTransform());
    expect(result.current.reduce).toBe(true);
    expect(result.current.tx('translateY(16px)')).toBe('none');
    expect(result.current.tx('translateY(20px) scale(0.92)')).toBe('none');
  });

  it('treats a null (pre-hydration) preference as not reduced', () => {
    reducedMotion.mockReturnValue(null);
    const { result } = renderHook(() => useMotionTransform());
    expect(result.current.reduce).toBe(false);
    expect(result.current.tx('scale(1)')).toBe('scale(1)');
  });
});
