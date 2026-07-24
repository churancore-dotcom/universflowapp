import { useState, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Upload,
  Music,
  ListMusic,
  Users,
  BarChart3,
  LogOut,
  ChevronLeft,
  Menu,
  X,
  Crown,
  Bell,
  Shield,
  ShieldCheck,
  
  Zap,
  Lock,
  MessageCircle,
  Smartphone,
  Gauge,
  IndianRupee,
  Headphones,
} from 'lucide-react';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
  { icon: IndianRupee, label: 'Revenue Insights', path: '/admin/revenue' },
  { icon: Headphones, label: 'Listener Insights', path: '/admin/listener-insights' },
  { icon: Upload, label: 'Upload Music', path: '/admin/upload' },
  { icon: Music, label: 'Manage Songs', path: '/admin/songs' },
  { icon: ShieldCheck, label: 'Artist Verification', path: '/admin/artist-applications' },
  { icon: Users, label: 'Manage Artists', path: '/admin/artists' },
  { icon: Music, label: 'Artist Signups', path: '/admin/artist-signups' },
  { icon: ListMusic, label: 'Playlists', path: '/admin/playlists' },
  { icon: Users, label: 'Users', path: '/admin/users' },
  { icon: Crown, label: 'Subscriptions', path: '/admin/subscriptions' },
  
  { icon: Crown, label: 'Payment Requests', path: '/admin/payments' },
  { icon: IndianRupee, label: 'Artist Payouts', path: '/admin/payouts' },
  { icon: Shield, label: 'Artist Claims', path: '/admin/artist-claims' },
  { icon: Zap, label: 'Engagement', path: '/admin/engagement' },
  { icon: Bell, label: 'Push Notifications', path: '/admin/notifications' },
  { icon: Smartphone, label: 'Registered Devices', path: '/admin/devices' },
  { icon: Lock, label: 'Security', path: '/admin/security' },
  { icon: Bell, label: 'Announcements', path: '/admin/announcements' },
  { icon: Shield, label: 'Moderation', path: '/admin/moderation' },
  { icon: BarChart3, label: 'Live Insights', path: '/admin/insights' },
  { icon: BarChart3, label: 'Analytics', path: '/admin/analytics' },
  { icon: BarChart3, label: 'Activity Logs', path: '/admin/logs' },
  { icon: BarChart3, label: 'System Health', path: '/admin/health' },
  { icon: Gauge, label: 'Performance Monitor', path: '/admin/performance' },
  { icon: MessageCircle, label: 'Support Inbox', path: '/admin/support' },
  { icon: Smartphone, label: 'App Updates', path: '/admin/app-updates' },
];

interface SidebarContentProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onLogout: () => void;
  showCloseButton: boolean;
}

// IMPORTANT: SidebarContent is defined OUTSIDE the AdminLayout component so it
// keeps a stable component identity across renders. Defining it inside caused
// the desktop sidebar to remount on every state change and the mobile drawer
// to "blink" or appear to re-open after navigation.
const SidebarContent = memo(({ currentPath, onNavigate, onClose, onLogout, showCloseButton }: SidebarContentProps) => (
  <div className="flex flex-col h-full">
    <div className="p-4 md:p-6 border-b border-white/5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Music className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg">Univers Flow</h1>
            <p className="text-xs text-muted-foreground">Admin Panel</p>
          </div>
        </div>
        {showCloseButton && (
          <button
            className="md:hidden p-2 rounded-lg hover:bg-white/10 transition-colors"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>

    <nav className="flex-1 p-3 md:p-4 space-y-1 overflow-y-auto">
      {navItems.map((item) => {
        const isActive = currentPath === item.path || (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`));
        const Icon = item.icon;
        return (
          <button
            key={item.path}
            type="button"
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground active:scale-[0.98]'
            }`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNavigate(item.path);
            }}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="truncate">{item.label}</span>
            {isActive && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
            )}
          </button>
        );
      })}
    </nav>

    <div className="p-3 md:p-4 border-t border-white/5 space-y-2">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all active:scale-[0.98]"
        onClick={() => onNavigate('/home')}
      >
        <ChevronLeft className="w-5 h-5 flex-shrink-0" />
        <span>Back to App</span>
      </button>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-all active:scale-[0.98]"
        onClick={onLogout}
      >
        <LogOut className="w-5 h-5 flex-shrink-0" />
        <span>Logout</span>
      </button>
    </div>
  </div>
));
SidebarContent.displayName = 'SidebarContent';

const AdminLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Safety net: close drawer if the route ever changes underneath us
  // (e.g. browser back/forward or programmatic navigation).
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    setSidebarOpen(false);
    await signOut();
    navigate('/auth');
  };

  // Close the drawer FIRST, then navigate on the next frame.
  // This prevents the touchend → synthetic click from landing on the
  // Menu button that sits exactly behind the tapped nav item once the
  // drawer disappears (the cause of the auto-reopen bug).
  const handleNavigation = (path: string) => {
    setSidebarOpen(false);
    if (path === location.pathname) return;
    requestAnimationFrame(() => navigate(path));
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 py-3 flex items-center justify-between safe-area-pt">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Music className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-display font-bold">Admin</span>
        </div>
        {/* Hide Menu button while drawer is open so a ghost-click after
            tapping a nav item cannot fall through and reopen it. */}
        {!sidebarOpen && (
          <button
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              key="backdrop"
              className="md:hidden fixed inset-0 bg-black/60 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeSidebar}
            />
            <motion.aside
              key="drawer"
              className="md:hidden fixed left-0 top-0 bottom-0 w-72 bg-background border-r border-white/5 z-50 flex flex-col safe-area-pt safe-area-pb"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <SidebarContent
                currentPath={location.pathname}
                onNavigate={handleNavigation}
                onClose={closeSidebar}
                onLogout={handleLogout}
                showCloseButton
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 glass-strong border-r border-white/5 flex-col flex-shrink-0">
        <SidebarContent
          currentPath={location.pathname}
          onNavigate={handleNavigation}
          onClose={closeSidebar}
          onLogout={handleLogout}
          showCloseButton={false}
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <Outlet key={location.pathname} />
      </main>
    </div>
  );
};

export default AdminLayout;
