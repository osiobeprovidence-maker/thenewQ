import { ShieldAlert } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface ConfigErrorScreenProps {
  missing: string[];
}

/**
 * Rendered when required frontend environment variables are missing or still hold
 * placeholder values. Lists variable NAMES only — never values — so the screen is
 * safe to show publicly and sends the operator straight to the fix.
 */
export function ConfigErrorScreen({ missing }: ConfigErrorScreenProps) {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#181818] p-6 sm:p-8 shadow-2xl">
        <BrandLogo />

        <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-400">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>

        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-white">
          Configuration required
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#B3B3B3]">
          JOIN THE QUEUE cannot start because the frontend configuration is incomplete.
          The following environment variable{missing.length === 1 ? ' is' : 's are'} missing or
          still set to placeholder values:
        </p>

        <ul
          aria-label="Missing environment variables"
          className="mt-4 list-none space-y-2 rounded-xl border border-white/10 bg-[#121212] p-4 font-mono text-xs text-amber-300"
        >
          {missing.map((name) => (
            <li key={name} className="break-all">
              {name}
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs leading-relaxed text-[#B3B3B3]">
          For security, values are never displayed here. Set these variables in the deployment
          environment (or in <span className="font-mono text-white">.env.local</span> for local
          development, see <span className="font-mono text-white">.env.example</span>) and reload
          the page. If the problem persists, contact the site operator.
        </p>

        {import.meta.env.DEV && (
          <p className="mt-3 rounded-lg border border-white/10 bg-[#121212] p-3 text-[11px] leading-relaxed text-[#B3B3B3]">
            Development mode: copy <span className="font-mono text-white">.env.example</span> to{' '}
            <span className="font-mono text-white">.env.local</span>, fill in your Firebase and
            Supabase project values, then restart the dev server.
          </p>
        )}
      </div>
    </main>
  );
}
