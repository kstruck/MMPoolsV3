import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { UI_EASE, UI_TRANSITION, useMotionTransform } from '../ui/motion';
import { Copy, Share2, CheckCircle, Gift, Users, Mail, MessageCircle } from 'lucide-react';
import { referralService } from '../../services/referralService';
import { db } from '../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

interface ReferralSharePanelProps {
  userId: string;
  userName: string;
}

interface ReferralConfig {
  creditsRequiredForFreePool: number;
  discountPerCredit: number;
  rewardType: 'free_pool' | 'discount';
}

const DEFAULT_CONFIG: ReferralConfig = {
  creditsRequiredForFreePool: 5,
  discountPerCredit: 5,
  rewardType: 'free_pool',
};

export const ReferralSharePanel: React.FC<ReferralSharePanelProps> = ({ userId, userName }) => {
  const { tx } = useMotionTransform();
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState<ReferralConfig>(DEFAULT_CONFIG);
  const [stats, setStats] = useState({
    totalReferred: 0,
    confirmedReferred: 0,
    pendingReferred: 0,
    creditsEarned: 0,
  });

  const [referralLink, setReferralLink] = useState<string>('Generating link...');

  useEffect(() => {
    referralService.generateReferralLink(userId).then(link => {
      setReferralLink(link);
    }).catch(err => {
      console.error("Error generating referral link", err);
      setReferralLink('Error generating link');
    });
  }, [userId]);
  const creditsNeeded = config.creditsRequiredForFreePool;
  const creditsRemaining = Math.max(0, creditsNeeded - stats.creditsEarned);
  const progressPercent = creditsNeeded > 0 ? Math.min(100, (stats.creditsEarned / creditsNeeded) * 100) : 0;

  // Subscribe to referral config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'referral_config'), (snap) => {
      if (snap.exists()) {
        setConfig(snap.data() as ReferralConfig);
      }
    });
    return unsub;
  }, []);

  // Subscribe to referral stats
  useEffect(() => {
    const unsub = referralService.subscribeToReferralStats(userId, setStats);
    return unsub;
  }, [userId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = referralLink;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const shareText = `Join me on March Melee Pools! Use my referral link:`;

  const shareLinks = {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(referralLink)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`,
    email: `mailto:?subject=${encodeURIComponent(`${userName} invited you to March Melee Pools`)}&body=${encodeURIComponent(`${shareText}\n\n${referralLink}`)}`,
  };

  return (
    <motion.div
      initial={{ opacity: 0, transform: tx('translateY(20px)') }}
      animate={{ opacity: 1, transform: tx('translateY(0px)') }}
      transition={UI_TRANSITION}
      className="bg-card border border-line rounded-2xl p-6 md:p-8 space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gold-500/15 rounded-xl flex items-center justify-center">
          <Share2 size={20} className="text-gold-500" />
        </div>
        <div>
          <h3 className="text-lg font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">Referral Program</h3>
          <p className="text-sm font-body text-muted">
            Invite friends and earn free pools
          </p>
        </div>
      </div>

      {/* Referral Link */}
      <div className="space-y-2">
        <label className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em]">
          Your Referral Link
        </label>
        <div className="flex gap-2">
          <code className="flex-grow bg-page border border-line rounded-lg p-3 text-xs md:text-sm font-mono num text-gold-700 dark:text-gold-400 truncate">
            {referralLink}
          </code>
          <button
            onClick={handleCopy}
            className={`px-4 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition-ui flex items-center gap-2 ${
              copied
                ? 'bg-[#0F7B4A] text-white'
                : 'bg-brandred-600 hover:bg-brandred-500 text-white shadow-[0_6px_16px_rgba(196,52,46,0.28)]'
            }`}
          >
            {copied ? (
              <>
                <CheckCircle size={16} />
                <span className="hidden sm:inline">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={16} />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Social Share Buttons */}
      <div className="space-y-2">
        <label className="text-xs font-display font-bold text-muted uppercase tracking-[0.08em]">
          Share via
        </label>
        <div className="flex flex-wrap gap-2">
          <a
            href={shareLinks.twitter}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-surface hover:bg-[#1DA1F2]/20 border border-line hover:border-[#1DA1F2]/50 text-[color:var(--text)] hover:text-[#1DA1F2] px-4 py-2.5 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-ui"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="hidden sm:inline">Twitter / X</span>
          </a>
          <a
            href={shareLinks.facebook}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-surface hover:bg-[#1877F2]/20 border border-line hover:border-[#1877F2]/50 text-[color:var(--text)] hover:text-[#1877F2] px-4 py-2.5 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-ui"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            <span className="hidden sm:inline">Facebook</span>
          </a>
          <a
            href={shareLinks.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-surface hover:bg-[#25D366]/20 border border-line hover:border-[#25D366]/50 text-[color:var(--text)] hover:text-[#25D366] px-4 py-2.5 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-ui"
          >
            <MessageCircle size={16} />
            <span className="hidden sm:inline">WhatsApp</span>
          </a>
          <a
            href={shareLinks.email}
            className="flex items-center gap-2 bg-surface hover:bg-gold-500/20 border border-line hover:border-gold-500/50 text-[color:var(--text)] hover:text-gold-600 dark:hover:text-gold-400 px-4 py-2.5 rounded-lg text-sm font-display font-bold uppercase tracking-[0.05em] transition-ui"
          >
            <Mail size={16} />
            <span className="hidden sm:inline">Email</span>
          </a>
        </div>
      </div>

      {/* Progress Tracker */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...UI_TRANSITION, delay: 0.05 }}
        className="bg-page border border-line rounded-xl p-5 space-y-4"
      >
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5">
              <Users size={14} className="text-gold-500" />
              <span className="text-xl font-display font-bold num text-[color:var(--text)]">{stats.totalReferred}</span>
            </div>
            <p className="text-xs text-muted font-body">Total Referred</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5">
              <CheckCircle size={14} className="text-[#0F7B4A]" />
              <span className="text-xl font-display font-bold num text-[color:var(--text)]">{stats.confirmedReferred}</span>
            </div>
            <p className="text-xs text-muted font-body">Confirmed</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5">
              <Gift size={14} className="text-gold-500" />
              <span className="text-xl font-display font-bold num text-[color:var(--text)]">{stats.creditsEarned}</span>
            </div>
            <p className="text-xs text-muted font-body">Credits Earned</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted font-body">
              Progress to Free Pool
            </span>
            <span className="text-gold-700 dark:text-gold-400 font-display font-bold num">
              {stats.creditsEarned} / {creditsNeeded}
            </span>
          </div>
          <div className="w-full bg-surface border border-line rounded-full h-2.5 overflow-hidden">
            <motion.div
              initial={{ transform: tx('scaleX(0)') }}
              animate={{ transform: tx(`scaleX(${Math.min(progressPercent, 100) / 100})`) }}
              transition={{ duration: 0.4, ease: UI_EASE, delay: 0.1 }}
              className="h-full w-full origin-left rounded-full bg-gold-foil"
            />
          </div>
          <p className="text-xs text-muted text-center font-body">
            {creditsRemaining > 0
              ? `${creditsRemaining} more referral${creditsRemaining !== 1 ? 's' : ''} until your free pool!`
              : 'You\'ve earned a free pool!'}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};
