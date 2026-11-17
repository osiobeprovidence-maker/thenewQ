import { BadgeCheck, ClipboardList, Compass } from 'lucide-react';

const STEPS = [
  {
    stepLabel: 'Step 1',
    title: 'FIND YOUR SLOT',
    description: 'Browse available subscription offers.',
    icon: Compass,
  },
  {
    stepLabel: 'Step 2',
    title: 'REGISTER YOUR DETAILS',
    description: 'Enter your name, email and WhatsApp number.',
    icon: ClipboardList,
  },
  {
    stepLabel: 'Step 3',
    title: 'GET CONFIRMATION',
    description: 'Receive your order confirmation and next steps.',
    icon: BadgeCheck,
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-black py-16 sm:py-24 border-b border-white/10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-[#1DB954]">Simple Process</p>
          <h2
            className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-white"
            style={{ textWrap: 'balance' }}
          >
            How It Works
          </h2>
          <p className="mt-3 text-base sm:text-lg text-[#B3B3B3]">
            From picking an open slot to receiving your confirmation, every step is clear and straightforward.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={item.stepLabel}
                className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#181818] p-6 sm:p-7 transition-colors duration-200 hover:border-[#1DB954]/50"
              >
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1DB954]/15 text-[#1DB954] border border-[#1DB954]/30">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <span className="font-mono text-sm font-semibold text-[#1DB954] tabular-nums">
                      0{idx + 1}
                    </span>
                  </div>

                  <p className="mt-6 text-xs font-semibold tracking-wider text-[#B3B3B3] uppercase">
                    {item.stepLabel}
                  </p>
                  <h3 className="mt-1.5 text-lg sm:text-xl font-bold tracking-tight text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 text-sm sm:text-base text-[#B3B3B3] leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
