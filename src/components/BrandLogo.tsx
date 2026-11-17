interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className = '' }: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 ${className}`}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="8" fill="#181818" stroke="rgba(255,255,255,0.12)" />
        {/* Front person in queue (highlighted green) */}
        <circle cx="21.5" cy="11.5" r="2.6" fill="#1DB954" />
        <path
          d="M17.2 21.5C17.2 18.8 19.1 17 21.5 17C23.9 17 25.8 18.8 25.8 21.5V22.5H17.2V21.5Z"
          fill="#1DB954"
        />
        {/* Middle person in queue (white) */}
        <circle cx="15.2" cy="12.5" r="2.3" fill="#FFFFFF" />
        <path
          d="M11.6 22C11.6 19.7 13.2 18.1 15.2 18.1C16.1 18.1 16.8 18.4 17.4 18.9"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        {/* Back person in queue (muted white) */}
        <circle cx="9.2" cy="13.5" r="2" fill="#B3B3B3" />
        <path
          d="M6.2 22C6.2 20.1 7.5 18.7 9.2 18.7C9.9 18.7 10.6 19 11.1 19.4"
          stroke="#B3B3B3"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-base sm:text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0">
        JOIN THE <span className="text-[#1DB954]">QUEUE</span>
      </span>
    </span>
  );
}
