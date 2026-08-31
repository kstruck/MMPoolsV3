// The `?` shortcut — PLAN-HELP-SYSTEM.md §3 D3 (T2).
//
// Four guards, each for a measured reason:
//
//   TYPING. `?` is an ordinary character. A commissioner writing "Who wins if
//   the game ties?" into the payment-instructions box must get a question mark,
//   not a help panel. Covers `<input>`, `<textarea>`, `<select>` and any
//   `contenteditable` host.
//
//   MODIFIERS. Shift is REQUIRED to type `?` on a US layout, so it cannot be
//   excluded; Ctrl/Meta/Alt combinations belong to the browser or the OS.
//
//   ALREADY HANDLED. `defaultPrevented` means something closer to the reader
//   has claimed the key.
//
//   ANOTHER OVERLAY OWNS THE SCREEN. See `ui/overlayStack.ts` — a modal is a
//   focus trap and opening a second panel behind it is not help.
//
// Matched on `event.key === '?'`, not on `code`/`keyCode`: the character is
// what the reader typed, and layouts that reach it without Shift still emit it.

import { useEffect } from 'react';
import { isForeignOverlayOpen } from '../ui/overlayStack';

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Is the event coming from somewhere the reader is entering text? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return TYPING_TAGS.has(el.tagName) || el.isContentEditable === true;
}

/** Should this keydown toggle the Help panel? Exported so a test can ask directly. */
export function shouldToggleHelp(event: KeyboardEvent, overlayId: string): boolean {
  if (event.key !== '?') return false;
  if (event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isTypingTarget(event.target)) return false;
  return !isForeignOverlayOpen(overlayId);
}

export function useHelpShortcut(overlayId: string, toggle: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldToggleHelp(event, overlayId)) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [overlayId, toggle]);
}
