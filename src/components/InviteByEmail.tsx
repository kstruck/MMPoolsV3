import React, { useMemo, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { invitesService } from '../services/invitesService';
import { getUserMessage } from '../utils/errorMessages';
import { useToast } from './ui/Toast';

// Shared "Invite by email" section for the share modals (bracket PoolShareModal
// and the squares/props ShareModal). Commissioners paste a list of addresses;
// the sendPoolInvites callable does permission checks + 24h rate limiting.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 50;
const MAX_NOTE_LENGTH = 500;

interface InviteByEmailProps {
    poolId: string;
}

export const InviteByEmail: React.FC<InviteByEmailProps> = ({ poolId }) => {
    const toast = useToast();
    const [rawEmails, setRawEmails] = useState('');
    const [personalNote, setPersonalNote] = useState('');
    const [isSending, setIsSending] = useState(false);

    const parsedEmails = useMemo(() => {
        const seen = new Set<string>();
        for (const token of rawEmails.split(/[\s,;]+/)) {
            const email = token.trim().toLowerCase();
            if (email && EMAIL_REGEX.test(email)) seen.add(email);
        }
        return Array.from(seen);
    }, [rawEmails]);

    const count = parsedEmails.length;
    const overLimit = count > MAX_EMAILS;

    const handleSend = async () => {
        if (count === 0 || overLimit || isSending) return;
        setIsSending(true);
        try {
            const { sent, skipped, invalid } = await invitesService.sendPoolInvites(
                poolId,
                parsedEmails,
                personalNote.trim() || undefined
            );
            const parts = [`Invited ${sent} ${sent === 1 ? 'person' : 'people'}.`];
            if (skipped > 0) parts.push(`${skipped} skipped (recently invited)`);
            if (invalid > 0) parts.push(`${invalid} invalid ${invalid === 1 ? 'address' : 'addresses'}`);
            const message = parts.length > 1 ? `${parts[0]} ${parts.slice(1).join(', ')}.` : parts[0];
            if (sent > 0) {
                toast.success(message);
                setRawEmails('');
                setPersonalNote('');
            } else {
                toast.info(message);
            }
        } catch (error) {
            toast.error(getUserMessage(error, 'Failed to send invites. Please try again.'));
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div>
            <label
                htmlFor={`invite-emails-${poolId}`}
                className="text-[12px] font-display font-bold text-[color:var(--text)] uppercase tracking-[0.08em] mb-2 flex items-center gap-1.5"
            >
                <Mail size={12} /> Invite by Email
            </label>
            <textarea
                id={`invite-emails-${poolId}`}
                value={rawEmails}
                onChange={(e) => setRawEmails(e.target.value)}
                placeholder="Paste emails, separated by commas or new lines"
                rows={3}
                disabled={isSending}
                className="w-full rounded-md border-[1.5px] border-line bg-page px-3 py-2.5 font-body text-sm text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none resize-y disabled:opacity-60"
            />
            <input
                type="text"
                value={personalNote}
                onChange={(e) => setPersonalNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
                placeholder="Add a personal note (optional)"
                disabled={isSending}
                maxLength={MAX_NOTE_LENGTH}
                className="w-full mt-2 min-h-[44px] rounded-md border-[1.5px] border-line bg-page px-3 py-2.5 font-body text-sm text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none disabled:opacity-60"
            />
            <button
                onClick={handleSend}
                disabled={count === 0 || overLimit || isSending}
                className="w-full mt-2 min-h-[44px] px-4 py-2.5 rounded-md text-sm font-display font-bold uppercase tracking-[0.05em] flex items-center justify-center gap-2 transition-all duration-150 bg-brandred-600 hover:bg-brandred-500 text-white shadow-[0_6px_16px_rgba(196,52,46,0.28)] disabled:bg-cream disabled:text-faint disabled:shadow-none disabled:cursor-not-allowed"
            >
                <Send size={15} />
                {isSending
                    ? 'Sending…'
                    : count === 0
                        ? 'Send invites'
                        : `Send ${count} ${count === 1 ? 'invite' : 'invites'}`}
            </button>
            {overLimit && (
                <p className="text-xs text-brandred-600 mt-2">
                    Max {MAX_EMAILS} addresses per batch — remove {count - MAX_EMAILS} to continue.
                </p>
            )}
        </div>
    );
};
