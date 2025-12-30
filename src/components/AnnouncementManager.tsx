import React, { useState, useEffect } from 'react';
import { Send, Clock, CheckCircle, AlertCircle } from 'lucide-react'; // Using lucide-react as standard in this project
import { GameState, Announcement } from '../types';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase'; // Assuming centralized firebase export

interface AnnouncementManagerProps {
    pool: GameState;
    currentUser: any;
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
                authorId: currentUser.uid,
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
            console.error("Failed to send announcement:", e);
            setFeedback({ type: 'error', msg: 'Failed to post announcement. ' + e.message });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">

            {/* COMPOSE SECTION */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 shadow-lg">
                <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                    <Send size={20} className="text-indigo-400" />
                    New Announcement
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                        <input
                            type="text"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                            placeholder="e.g. Q1 Winners Posted!"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-indigo-500 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                        <textarea
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Write your message here..."
                            rows={4}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-indigo-500 transition-colors resize-none"
                        />
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <p className="text-xs text-slate-500">
                            This will be emailed to all participants and shown in the app.
                        </p>
                        <button
                            onClick={handleSend}
                            disabled={isSending || !subject || !message}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20"
                        >
                            {isSending ? 'Sending...' : 'Post & Email'}
                            <Send size={16} />
                        </button>
                    </div>

                    {feedback && (
                        <div className={`p-3 rounded-lg border flex items-center gap-2 text-sm ${feedback.type === 'success' ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-400' : 'bg-rose-900/20 border-rose-500/30 text-rose-400'
                            }`}>
                            {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                            {feedback.msg}
                        </div>
                    )}
                </div>
            </div>

            {/* HISTORY SECTION */}
            <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-6">
                <h3 className="text-slate-400 font-bold text-sm uppercase mb-4 flex items-center gap-2">
                    <Clock size={16} />
                    History ({history.length})
                </h3>

                <div className="space-y-3">
                    {history.length === 0 ? (
                        <p className="text-slate-600 text-sm italic text-center py-8">No announcements yet.</p>
                    ) : (
                        history.map(item => (
                            <div key={item.id} className="bg-slate-800/50 rounded-lg p-4 border border-slate-800 hover:border-slate-700 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="text-white font-bold">{item.subject}</h4>
                                    <span className="text-xs text-slate-500">
                                        {item.createdAt ? new Date((item.createdAt as any).seconds * 1000).toLocaleString() : 'Just now'}
                                    </span>
                                </div>
                                <p className="text-slate-400 text-sm whitespace-pre-wrap">{item.message}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>

        </div>
    );
};
