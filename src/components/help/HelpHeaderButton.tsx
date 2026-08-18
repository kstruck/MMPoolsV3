// The header's Help button — PLAN-HELP-SYSTEM.md §6 K3 (T2).
//
// K3 CHOSE THE HEADER OVER SPECTRUM'S FLOATING BUTTON. A bottom-right floating
// button collides with the sticky save bar on the pick sheets
// (`pickSheet/StickySaveBar.tsx`) and with the mobile tab strips — on the two
// screens a member spends the most time on.
//
// It renders nothing when no panel is mounted. Routes with no `Header` at all
// (`pages/PaymentSuccess.tsx`, the 404) are shortcut-only by design and are
// allowlisted as such; they are transient and have nothing to explain.

import { HelpCircle } from 'lucide-react';
import { useHelpPanelControl } from './useHelpPanel';
import { HELP_PANEL_ID } from './HelpPanel';
import { cn } from '../ui/cn';

export function HelpHeaderButton({ className }: { className?: string }) {
  const control = useHelpPanelControl();
  if (!control) return null;
  return (
    <button
      type="button"
      onClick={control.toggle}
      // `data-help-trigger` keeps the panel's click-outside handler from
      // treating this click as "outside" — otherwise the button would open and
      // immediately close the panel on the same press.
      data-help-trigger=""
      aria-label="Help (?)"
      aria-expanded={control.isOpen}
      aria-controls={HELP_PANEL_ID}
      className={cn(
        'inline-flex items-center justify-center rounded-[8px] p-1.5 text-white/70 transition-colors hover:text-white',
        control.isOpen && 'text-gold-400',
        className,
      )}
    >
      <HelpCircle size={16} aria-hidden="true" />
    </button>
  );
}
