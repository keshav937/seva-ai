export function SevaLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const iconDim = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8';
  const textClass = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        viewBox="0 0 36 36"
        className={`${iconDim} shrink-0`}
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M18 2.5L5.5 7.5V16.8C5.5 25.1 10.8 31.8 18 34C25.2 31.8 30.5 25.1 30.5 16.8V7.5L18 2.5Z"
          fill="#14532D"
        />
        <path
          d="M18 6.5L9 10.1V16.7C9 23 12.8 28.2 18 30.1C23.2 28.2 27 23 27 16.7V10.1L18 6.5Z"
          fill="#059669"
        />
        <path
          d="M18 11.5L13.5 17.5H17.2L16.3 24.5L22.5 17H18.5L18 11.5Z"
          fill="#F8FAF9"
        />
      </svg>
      <span className={`${textClass} font-bold tracking-tight text-slate-900 font-display`}>
        SEVA AI
      </span>
    </span>
  );
}
