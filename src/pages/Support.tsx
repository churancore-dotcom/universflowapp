import { motion } from 'framer-motion';
import { ChevronLeft, Heart, Crown, Star, MessageSquare, ChevronRight } from 'lucide-react';
import { useNavigate } from '@/lib/router-compat';
import { useState } from 'react';
import BottomNav from '@/components/BottomNav';
import PageTransition from '@/components/PageTransition';
import { iosSpring, iosBounce } from '@/lib/animations';
import { useAuth } from '@/contexts/AuthContext';
import { usePremium } from '@/hooks/usePremium';
import Footer from '@/components/Footer';
import SupportChatModal from '@/components/SupportChatModal';
import SEOHead from '@/components/SEOHead';

const ROSE = '#FF2D55';

const Support = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isPremium } = usePremium();
  const [showChat, setShowChat] = useState(false);

  const premiumFeatures = [
    { icon: '🎵', title: 'Ad-Free Listening', description: 'Enjoy music without interruptions' },
    { icon: '📥', title: 'Offline Downloads', description: 'Listen anywhere, anytime' },
    { icon: '🎧', title: 'High-Quality Audio', description: 'Up to 320kbps audio quality' },
    { icon: '⭐', title: 'Exclusive Content', description: 'Access premium-only tracks' },
  ];

  return (
    <PageTransition>
      <SEOHead
        title="Support & Help Center — Univers Flow"
        description="Get help with Univers Flow: chat with support, report issues, request features and learn about premium benefits."
        keywords="Univers Flow support, help center, contact, music app help"
        path="/support"
        jsonLdId="support-jsonld"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'ContactPage',
          name: 'Univers Flow — Support',
          url: 'https://universflow.in/support',
          isPartOf: { '@type': 'WebSite', name: 'Univers Flow', url: 'https://universflow.in' },
        }}
      />
      <motion.div
        className="relative min-h-screen bg-background pb-44 overflow-hidden"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
      >
        {/* Static rose ambient glow (no animation — perf) */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full"
          style={{
            background: `radial-gradient(circle, ${ROSE}33 0%, transparent 65%)`,
            filter: 'blur(40px)',
          }}
        />

        {/* Frosted header */}
        <motion.header
          className="sticky top-0 z-30 px-2 pt-4 pb-3 flex items-center safe-area-pt"
          style={{
            background: 'hsl(var(--background) / 0.7)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            borderBottom: '0.5px solid hsl(var(--foreground) / 0.08)',
          }}
          initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} transition={iosSpring}
        >
          <motion.button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 px-2 py-2 -ml-1"
            style={{ color: ROSE }}
            whileTap={{ scale: 0.95, opacity: 0.7 }} transition={iosBounce}
          >
            <ChevronLeft className="w-6 h-6" />
            <span className="text-[17px]">Back</span>
          </motion.button>
          <motion.h1
            className="text-[17px] font-semibold absolute left-1/2 -translate-x-1/2"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          >
            Support
          </motion.h1>
        </motion.header>

        <main className="relative px-5 pt-4 space-y-7">
          {/* Hero */}
          <motion.section
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ ...iosSpring, delay: 0.05 }}
            className="text-center pt-4 pb-2"
          >
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ ...iosSpring, delay: 0.1 }}
              className="w-[88px] h-[88px] mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${ROSE}, #ff5d7d)`,
                boxShadow: `0 18px 48px -12px ${ROSE}99, inset 0 1px 0 rgba(255,255,255,0.25)`,
              }}
            >
              <Heart className="w-10 h-10 text-white" fill="white" />
            </motion.div>
            <h2 className="text-[26px] font-bold tracking-tight mb-1.5">Support Universflow</h2>
            <p className="text-[14px] text-muted-foreground max-w-[300px] mx-auto leading-snug">
              Help keep the music playing. Your support keeps the app free and fuels new features.
            </p>
          </motion.section>

          {/* Premium status */}
          {isPremium && (
            <motion.section
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ ...iosSpring, delay: 0.1 }}
              className="rounded-2xl p-4"
              style={{
                background: `linear-gradient(135deg, ${ROSE}22, ${ROSE}0d)`,
                border: `0.5px solid ${ROSE}44`,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{ background: ROSE, boxShadow: `0 8px 20px -6px ${ROSE}aa` }}
                >
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-[15px]" style={{ color: ROSE }}>Premium Member</p>
                  <p className="text-[13px] text-muted-foreground">Thanks for keeping the lights on ✨</p>
                </div>
              </div>
            </motion.section>
          )}

          {/* Premium features (non-premium only) */}
          {!isPremium && (
            <motion.section
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ ...iosSpring, delay: 0.1 }}
            >
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-2 px-1">
                Premium
              </h3>
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: 'hsl(var(--card) / 0.6)',
                  border: '0.5px solid hsl(var(--foreground) / 0.08)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                }}
              >
                {premiumFeatures.map((feature, index) => (
                  <div
                    key={feature.title}
                    className={`px-4 py-3.5 flex items-center gap-3.5 ${
                      index < premiumFeatures.length - 1
                        ? 'border-b'
                        : ''
                    }`}
                    style={index < premiumFeatures.length - 1 ? { borderColor: 'hsl(var(--foreground) / 0.06)' } : undefined}
                  >
                    <span className="text-[22px] leading-none">{feature.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[15px] leading-tight">{feature.title}</p>
                      <p className="text-[12.5px] text-muted-foreground leading-tight mt-0.5">{feature.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={iosBounce}
                onClick={() => navigate('/premium')}
                className="w-full mt-4 py-3.5 rounded-full font-semibold text-[16px] text-white"
                style={{
                  background: `linear-gradient(135deg, ${ROSE}, #ff5d7d)`,
                  boxShadow: `0 12px 28px -10px ${ROSE}bb`,
                }}
              >
                Upgrade to Premium
              </motion.button>
              <p className="text-center text-[11.5px] text-muted-foreground mt-2">
                See all premium features & pricing
              </p>
            </motion.section>
          )}

          {/* Need Help */}
          <motion.section
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ ...iosSpring, delay: 0.15 }}
          >
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-2 px-1">
              Need Help?
            </h3>
            <motion.button
              whileTap={{ scale: 0.985 }}
              transition={iosBounce}
              onClick={() => setShowChat(true)}
              className="w-full flex items-center gap-3.5 p-4 rounded-2xl text-left"
              style={{
                background: 'hsl(var(--card) / 0.6)',
                border: '0.5px solid hsl(var(--foreground) / 0.08)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${ROSE}1f` }}
              >
                <MessageSquare className="w-5 h-5" style={{ color: ROSE }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[15px] leading-tight">Chat with Support</p>
                <p className="text-[12.5px] text-muted-foreground leading-tight mt-0.5">Get help in real time</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
            </motion.button>
          </motion.section>

          {/* Supporters */}
          <motion.section
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ ...iosSpring, delay: 0.2 }}
          >
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-2 px-1 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5" style={{ color: ROSE }} fill={ROSE} />
              Our Supporters
            </h3>
            <div
              className="relative rounded-3xl p-6 overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${ROSE}26, ${ROSE}0d 60%, transparent)`,
                border: `0.5px solid ${ROSE}33`,
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: `0 20px 60px -24px ${ROSE}66`,
              }}
            >
              <div
                aria-hidden
                className="absolute -top-16 -right-12 w-44 h-44 rounded-full opacity-40"
                style={{ background: ROSE, filter: 'blur(50px)' }}
              />

              <div className="relative text-center">
                <motion.div
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ ...iosSpring, delay: 0.25 }}
                  className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center text-[26px]"
                  style={{
                    background: `linear-gradient(135deg, ${ROSE}, #ff5d7d)`,
                    boxShadow: `0 10px 28px -8px ${ROSE}aa`,
                  }}
                >
                  💖
                </motion.div>
                <h4 className="text-[19px] font-bold mb-1.5 tracking-tight">
                  {user
                    ? `You're a legend${user.email ? `, ${user.email.split('@')[0]}` : ''}!`
                    : 'You are the heartbeat of Universflow'}
                </h4>
                <p className="text-[13px] text-muted-foreground max-w-[280px] mx-auto leading-relaxed">
                  Every play, every share, every kind word keeps this app alive.
                  From all of us: <span className="text-foreground font-semibold">thank you</span>. 🎶
                </p>

                <div className="flex justify-center gap-1.5 flex-wrap mt-4">
                  {['💖', '🎵', '🎧', '🎼', '🎶', '🚀', '🙏'].map((emoji, i) => (
                    <motion.span
                      key={i}
                      initial={{ scale: 0, y: 10 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{ delay: 0.3 + i * 0.04, type: 'spring', stiffness: 300 }}
                      className="text-[20px]"
                    >
                      {emoji}
                    </motion.span>
                  ))}
                </div>

                {isPremium && (
                  <p
                    className="mt-4 text-[11px] font-semibold inline-flex items-center gap-1.5"
                    style={{ color: ROSE }}
                  >
                    <Crown className="w-3.5 h-3.5" />
                    Premium supporter — VIP status unlocked
                  </p>
                )}
              </div>
            </div>
          </motion.section>

          <Footer />
        </main>

        <BottomNav />
        <SupportChatModal isOpen={showChat} onClose={() => setShowChat(false)} />
      </motion.div>
    </PageTransition>
  );
};

export default Support;
