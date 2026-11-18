import { useEffect, useState } from 'react';
import { LogIn, LogOut, Menu, User, X } from 'lucide-react';
import type { AppView } from '../types/subscription';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  activeView: AppView;
  hasProfile: boolean;
  onNavigateSection: (sectionId: string) => void;
  onOpenProfile: () => void;
  onJoinNow: () => void;
  onOpenAuthModal?: () => void;
}

const SECTION_LINKS = [
  { label: 'Home', sectionId: 'home' },
  { label: 'Available Plans', sectionId: 'plans' },
  { label: 'How It Works', sectionId: 'how-it-works' },
  { label: 'FAQs', sectionId: 'faqs' },
];

export function Navbar({
  activeView,
  hasProfile,
  onNavigateSection,
  onOpenProfile,
  onJoinNow,
  onOpenAuthModal,
}: NavbarProps) {
  const { currentUser, profile, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSectionClick = (sectionId: string) => {
    setMobileMenuOpen(false);
    onNavigateSection(sectionId);
  };

  const handleProfileClick = () => {
    setMobileMenuOpen(false);
    onOpenProfile();
  };

  const handleJoinClick = () => {
    setMobileMenuOpen(false);
    onJoinNow();
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-black/90 backdrop-blur-md border-b border-white/10">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleSectionClick('home')}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] rounded-md text-left cursor-pointer shrink-0"
          aria-label="JOIN THE QUEUE Home"
        >
          <BrandLogo />
        </button>

        {/* Zone 2: Navigation Links */}
        <nav
          aria-label="Primary navigation"
          className="hidden lg:flex items-center gap-5 lg:gap-7 text-sm font-medium text-[#B3B3B3]"
        >
          {SECTION_LINKS.map((item) => (
            <button
              key={item.sectionId}
              type="button"
              onClick={() => handleSectionClick(item.sectionId)}
              className="whitespace-nowrap shrink-0 py-1 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] rounded cursor-pointer"
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleProfileClick}
            aria-current={activeView === 'profile' ? 'page' : undefined}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] rounded cursor-pointer ${
              activeView === 'profile'
                ? 'text-[#1DB954] font-semibold'
                : currentUser || hasProfile
                  ? 'text-white hover:text-[#1DB954]'
                  : 'text-[#B3B3B3] hover:text-white'
            }`}
          >
            My Profile
          </button>
        </nav>

        {/* Zone 3: Auth + Primary CTA + Mobile Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          {currentUser ? (
            <div className="hidden sm:flex items-center gap-3">
              <button
                type="button"
                onClick={handleProfileClick}
                className="flex items-center gap-2 rounded-full border border-white/20 bg-[#181818] py-1.5 px-3 text-xs font-medium text-white hover:border-[#1DB954] transition-colors"
              >
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt="Avatar"
                    className="w-5 h-5 rounded-full object-cover"
                  />
                ) : (
                  <User className="w-3.5 h-3.5 text-[#1DB954]" />
                )}
                <span>{profile?.display_name || currentUser.displayName || 'Member'}</span>
              </button>
              <button
                type="button"
                onClick={() => logout()}
                title="Sign Out"
                className="p-2 rounded-full text-[#B3B3B3] hover:text-white hover:bg-[#181818] transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-[#121212] px-4 py-2 text-xs font-bold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
          )}

          <button
            type="button"
            onClick={handleJoinClick}
            className="hidden lg:inline-flex items-center justify-center rounded-full bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition-all duration-150 hover:bg-[#15803D] hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] focus-visible:ring-offset-2 focus-visible:ring-offset-black whitespace-nowrap shrink-0 cursor-pointer"
          >
            Join Now
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="inline-flex lg:hidden items-center justify-center rounded-lg p-2.5 min-w-[44px] min-h-[44px] text-[#B3B3B3] hover:text-white hover:bg-[#181818] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-drawer"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-drawer"
          className="lg:hidden border-t border-white/10 bg-[#121212] px-4 py-4"
        >
          <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
            {SECTION_LINKS.map((item) => (
              <button
                key={item.sectionId}
                type="button"
                onClick={() => handleSectionClick(item.sectionId)}
                className="flex items-center min-h-[44px] rounded-lg px-3 text-left text-base font-medium text-[#B3B3B3] hover:bg-[#181818] hover:text-white transition-colors cursor-pointer"
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={handleProfileClick}
              className={`flex items-center min-h-[44px] rounded-lg px-3 text-left text-base font-medium transition-colors cursor-pointer ${
                activeView === 'profile'
                  ? 'bg-[#181818] text-[#1DB954] font-semibold'
                  : 'text-[#B3B3B3] hover:bg-[#181818] hover:text-white'
              }`}
            >
              My Profile
            </button>

            {currentUser ? (
              <div className="pt-3 mt-2 border-t border-white/10 flex items-center justify-between px-3">
                <span className="text-sm text-white font-medium">
                  {profile?.display_name || currentUser.displayName || 'Member'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setMobileMenuOpen(false);
                  }}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="pt-3 mt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenAuthModal?.();
                  }}
                  className="w-full min-h-[44px] mb-2 rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-bold text-white transition-colors hover:border-[#1DB954]"
                >
                  Sign In
                </button>
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleJoinClick}
                className="w-full min-h-[44px] rounded-full bg-[#1DB954] px-5 py-3 text-sm font-bold text-black transition-colors duration-150 hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                Join Now
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
