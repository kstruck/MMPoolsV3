import { logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import { Send, Clock, CheckCircle, AlertCircle } from 'lucide-react'; // Using lucide-react as standard in this project
import { Button } from './ui';
import type { GameState, Announcement, User } from '../types';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase'; // Assuming centralized firebase export

interface AnnouncementManagerProps {
    pool: GameState;
    currentUser: User;
}

export const AnnouncementManager: React.FC<AnnouncementManagerProps> = ({ pool, currentUser }) => {
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [history, setHistory] = useState<Announcement[]>([]);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

    // Load History
    useEffect(() => {
        if (!pool.id) return;
        const q = query(
            collection(db, 'pools', pool.id, 'announcements'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Announcement[];
            setHistory(data);
        });

        return () => unsubscribe();
    }, [pool.id]);

    const handleSend = async () => {
        if (!subject.trim() || !message.trim()) return;
        setIsSending(true);
        setFeedback(null);

        try {
            // 1. Write to subcollection
            // This will trigger the Cloud Function to send emails
            await addDoc(collection(db, 'pools', pool.id, 'announcements'), {
                poolId: pool.id,
                authorId: currentUser.id,
                subject: subject.trim(),
                message: message.trim(),
                createdAt: serverTimestamp(),
                readBy: []
            });

            setSubject('');
            setMessage('');
            setFeedback({ type: 'success', msg: 'Announcement posted and emails queued!' });

            // Clear success message after 3s
            setTimeout(() => setFeedback(null), 3000);

        } catch (e: any) {
            logger.error("Failed to send announcement:", e);
            setFeedback({ type: 'error', msg: 'Failed to post announcement. ' + e.message });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in">

            {/* COMPOSE SECTION */}
            <div className="bg-card rounded-xl border border-line p-6 shadow-card">
                <h3 className="text-[color:var(--text)] font-display font-bold uppercase tracking-[0.02em] text-lg mb-4 flex items-center gap-2">
                    <Send size={20} className="text-gold-500" />
                    New Announcement
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Subject</label>
                        <input
                            type="text"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            placeholder="e.g. Q1 Winners Posted!"
                            className="w-full bg-surface border border-line rounded-lg px-4 py-2 font-body text-[color:var(--text)] outline-none focus:border-gold-500 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-display font-bold text-muted uppercase tracking-[0.08em] mb-1">Message</label>
                        <textarea
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Write your message here..."
                            rows={4}
                            className="w-full bg-surface border border-line rounded-lg px-4 py-2 font-body text-[color:var(--text)] outline-none focus:border-gold-500 transition-colors resize-none"
                        />
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <p className="text-xs font-body text-muted">
                            This will be emailed to all participants and shown in the app.
                        </p>
                        <Button
                            onClick={handleSend}
                            disabled={isSending || !subject || !message}
                            size="sm"
                        >
                            {isSending ? 'Sending...' : 'Post & Email'}
                            <Send size={16} />
                        </Button>
                    </div>

                    {feedback && (
                        <div className={`p-3 rounded-lg border flex items-center gap-2 font-body text-sm ${feedback.type === 'success' ? 'bg-[#E4F5EC] border-[#BEE7D0] text-[#0F7B4A]' : 'bg-brandred-600/10 border-brandred-600/30 text-brandred-600'
                            }`}>
                            {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                            {feedback.msg}
                        </div>
                    )}
                </div>
            </div>

            {/* HISTORY SECTION */}
            <div className="bg-surface rounded-xl border border-line p-6">
                <h3 className="text-muted font-display font-bold text-sm uppercase tracking-[0.08em] mb-4 flex items-center gap-2">
                    <Clock size={16} />
                    History (<span className="num">{history.length}</span>)
                </h3>

                <div className="space-y-3">
                    {history.length === 0 ? (
                        <p className="text-faint text-sm italic text-center py-8">No announcements yet.</p>
                    ) : (
                        history.map(item => (
                            <div key={item.id} className="bg-card rounded-lg p-4 border border-line hover:border-gold-500/40 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="text-[color:var(--text)] font-display font-bold uppercase tracking-[0.02em]">{item.subject}</h4>
                                    <span className="text-xs text-faint num">
                                        {item.createdAt ? new Date((item.createdAt as any).seconds * 1000).toLocaleString() : 'Just now'}
                                    </span>
                                </div>
                                <p className="text-muted font-body text-sm whitespace-pre-wrap">{item.message}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>

        </div>
    );
};
