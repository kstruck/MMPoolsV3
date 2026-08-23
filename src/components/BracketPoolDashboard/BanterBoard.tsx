import React, { useState, useEffect, useRef } from 'react';
import { Send, Clock, MessageSquare as MessageSquareIcon } from 'lucide-react';
import { dbService } from '../../services/dbService';
import type { BanterMessage, User } from '../../types';

interface BanterBoardProps {
    poolId: string;
    user: User | null;
}

export const BanterBoard: React.FC<BanterBoardProps> = ({ poolId, user }) => {
    const [messages, setMessages] = useState<BanterMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const unsub = dbService.subscribeToBanterMessages(poolId, (msgs) => {
            setMessages(msgs);
        });
        return () => unsub();
    }, [poolId]);

    useEffect(() => {
        if (messagesEndRef.current) {
            const container = messagesEndRef.current.parentElement;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !user) return;

        setSending(true);
        try {
            await dbService.sendBanterMessage(poolId, {
                // ⚠️ `authorUid` is what firestore.rules binds to request.auth.uid.
                // This writer only ever sent userId/userName, so EVERY send from
                // this board was permission-denied — a pre-existing break, found
                // by codex reviewing T9 (the rule required authorUid at
                // origin/main too). Both shapes are written: the new fields
                // satisfy the rule, the legacy ones keep this board's own
                // `isMe` comparison and older rows rendering.
                authorUid: user.id,
                authorName: user.name || user.email?.split('@')[0] || 'Anonymous User',
                kind: 'COMMISSIONER',
                userId: user.id,
                userName: user.name || user.email?.split('@')[0] || 'Anonymous User',
                text: newMessage.trim(),
                timestamp: Date.now()
            });
            setNewMessage('');
        } catch (error) {
            console.error("Failed to send message:", error);
        } finally {
            setSending(false);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(new Date(timestamp));
    };

    return (
        <div className="flex flex-col h-[600px] bg-card rounded-xl border border-line shadow-card overflow-hidden">
            <div className="p-4 border-b border-line bg-card/80 sticky top-0 z-10">
                <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                    <MessageSquareIcon className="w-5 h-5 text-gold-500" />
                    Banter Board
                </h2>
                <p className="text-sm font-body text-muted mt-1">Chat real-time with other pool members.</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-faint space-y-2">
                        <MessageSquareIcon className="w-8 h-8 opacity-50" />
                        <p>No messages yet. Start the trash talk!</p>
                    </div>
                ) : (
                    messages.map((msg) => {
                        const isMe = (msg.authorUid ?? msg.userId) === user?.id;
                        return (
                            <div
                                key={msg.id}
                                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                            >
                                <div className="flex items-baseline gap-2 px-1">
                                    <span className={`text-xs font-semibold ${isMe ? 'text-gold-600' : 'text-muted'}`}>
                                        {isMe ? 'You' : (msg.authorName ?? msg.userName)}
                                    </span>
                                    <span className="text-[10px] text-faint flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {formatDate(msg.timestamp)}
                                    </span>
                                </div>
                                <div
                                    className={`px-4 py-2 rounded-2xl max-w-[85%] break-words font-body ${isMe
                                        ? 'bg-navy-800 text-white rounded-tr-sm'
                                        : 'bg-surface border border-line text-[color:var(--text)] rounded-tl-sm'
                                        }`}
                                >
                                    {msg.text}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-line bg-surface/50">
                {user ? (
                    <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                        <div className="flex-1 relative">
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="Talk some trash..."
                                className="w-full bg-card border border-line rounded-xl py-3 pl-4 pr-12 font-body text-[color:var(--text)] placeholder:text-faint focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 transition-colors"
                                disabled={sending}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={!newMessage.trim() || sending}
                            className="p-3 bg-brandred-600 text-white rounded-xl hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 flex items-center justify-center"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </form>
                ) : (
                    <div className="text-center p-3 text-muted bg-card rounded-lg border border-line">
                        Please sign in to participate in the banter.
                    </div>
                )}
            </div>
        </div>
    );
};


