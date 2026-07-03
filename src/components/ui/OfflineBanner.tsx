import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Slim global banner shown while the browser reports no connectivity.
 * Submits will fail offline — better the user knows before tapping.
 */
export const OfflineBanner: React.FC = () => {
    const [online, setOnline] = useState(() => navigator.onLine);

    useEffect(() => {
        const up = () => setOnline(true);
        const down = () => setOnline(false);
        window.addEventListener('online', up);
        window.addEventListener('offline', down);
        return () => {
            window.removeEventListener('online', up);
            window.removeEventListener('offline', down);
        };
    }, []);

    if (online) return null;

    return (
        <div role="alert" className="sticky top-0 z-[90] bg-gold-600 text-navy-950 text-center text-xs font-display font-bold uppercase tracking-[0.05em] py-2 px-4 flex items-center justify-center gap-2">
            <WifiOff size={14} aria-hidden="true" />
            You're offline — picks and changes won't save until you reconnect.
        </div>
    );
};
