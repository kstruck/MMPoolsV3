
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

interface AuditEvent {
    id: string;
    type: string;
    message: string;
    timestamp: number;
    severity: 'INFO' | 'WARNING' | 'ERROR';
    payload?: any;
    actor?: { role: string, email?: string };
}

export const AuditLogViewer: React.FC<{ poolId: string }> = ({ poolId }) => {
    const [events, setEvents] = useState<AuditEvent[]>([]);

    useEffect(() => {
        const q = query(
            collection(db, 'pools', poolId, 'audit'),
            orderBy('timestamp', 'desc'),
            limit(50)
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const newEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditEvent));
            setEvents(newEvents);
        });

        return () => unsub();
    }, [poolId]);

    return (
        <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden h-96 flex flex-col shadow-inner">
            <div className="bg-slate-800 p-2 border-b border-slate-700 font-bold text-xs uppercase text-slate-400 flex justify-between items-center">
                <span>Live Audit Log</span>
                <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">Last 50 Events</span>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-2 font-mono text-xs scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                {events.length === 0 && <div className="text-slate-500 italic p-4 text-center">No events logged yet. Perform an action to see logs.</div>}

                {events.map(ev => (
                    <div key={ev.id} className="border-l-2 border-slate-700 pl-2 py-1 hover:bg-slate-800/30 transition-colors">
                        <div className="flex justify-between items-center text-slate-500 mb-1">
                            <span className="text-[10px]">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                            <span className={`text-[10px] font-bold px-1 rounded ${ev.severity === 'ERROR' ? 'bg-rose-900/50 text-rose-400' :
                                    ev.severity === 'WARNING' ? 'bg-amber-900/50 text-amber-400' :
                                        'bg-slate-800 text-slate-400'
                                }`}>{ev.type}</span>
                        </div>
                        <div className="text-slate-300 break-words leading-tight">{ev.message}</div>
                        {ev.actor && (
                            <div className="text-[10px] text-slate-600 mt-0.5">By: {ev.actor.role}</div>
                        )}
                        {ev.payload && (
                            <details className="mt-1 group">
                                <summary className="cursor-pointer text-[10px] text-indigo-400 hover:text-indigo-300 select-none">
                                    View Payload
                                </summary>
                                <pre className="bg-black/50 p-2 rounded mt-1 text-[10px] text-emerald-400 overflow-x-auto whitespace-pre-wrap border border-slate-800/50">
                                    {JSON.stringify(ev.payload, null, 2)}
                                </pre>
                            </details>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
