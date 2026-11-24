import React from "react";

interface IconProps {
  size?: number;
  className?: string;
}

const baseProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true as const,
});

export const CursorIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M5 3l14 7-6 2-2 6-6-15z" />
  </svg>
);

export const HandIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M18 11V6a2 2 0 0 0-4 0v4" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10V5a2 2 0 0 0-4 0v9" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.5L3.3 15.7a1.7 1.7 0 0 1 2.4-2.4L8 15" />
  </svg>
);

export const PinIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const MarqueeIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />
  </svg>
);

export const FreezeIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" />
  </svg>
);

export const CompareIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="3" y="4" width="8" height="16" rx="1.5" />
    <rect x="13" y="4" width="8" height="16" rx="1.5" />
  </svg>
);

export const PlayIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
  </svg>
);

export const PlayOutlineIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <polygon points="7 4 19 12 7 20 7 4" />
  </svg>
);

export const GridIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);

export const FrameIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
  </svg>
);

export const SlidersIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <circle cx="9" cy="7" r="2" fill="#fff" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="15" cy="17" r="2" fill="#fff" />
  </svg>
);

export const ChatIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 3c4.97 0 9 3.58 9 8s-4.03 8-9 8a9.8 9.8 0 0 1-3.8-.75L3 20l1.45-4.35C3.52 14.3 3 12.7 3 11c0-4.42 4.03-8 9-8z" />
  </svg>
);

export const RefreshIcon: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <polyline points="21 3 21 9 15 9" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const LockIcon: React.FC<IconProps> = ({ size = 13, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const SunIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const SparkleScrollIcon: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="4" y="4" width="16" height="16" rx="4" fill="#18181b" stroke="none" />
    <path d="M9 9h6M9 12h6M9 15h3.5" stroke="#fff" strokeWidth="1.6" />
  </svg>
);
