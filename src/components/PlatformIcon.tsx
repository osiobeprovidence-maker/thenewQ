import {
  Facebook,
  Globe,
  Hash,
  Instagram,
  Linkedin,
  Music2,
  Send,
  Twitter,
  Youtube,
} from 'lucide-react';
import type { SocialPlatform } from '../lib/settingsService';

/**
 * Maps each supported social platform to its recognizable brand-style icon.
 * Custom platforms fall back to a generic globe.
 */
export function PlatformIcon({
  platform,
  className = 'h-4 w-4',
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  switch (platform) {
    case 'instagram':
      return <Instagram className={className} aria-hidden="true" />;
    case 'x':
      return <Twitter className={className} aria-hidden="true" />;
    case 'facebook':
      return <Facebook className={className} aria-hidden="true" />;
    case 'tiktok':
      return <Music2 className={className} aria-hidden="true" />;
    case 'telegram':
      return <Send className={className} aria-hidden="true" />;
    case 'youtube':
      return <Youtube className={className} aria-hidden="true" />;
    case 'discord':
      return <Hash className={className} aria-hidden="true" />;
    case 'linkedin':
      return <Linkedin className={className} aria-hidden="true" />;
    case 'custom':
    default:
      return <Globe className={className} aria-hidden="true" />;
  }
}
