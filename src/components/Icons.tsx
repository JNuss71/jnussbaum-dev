import React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

const IconBase: React.FC<IconProps & { children: React.ReactNode }> = ({
  children,
  size = 18,
  color = 'currentColor',
  strokeWidth = 2,
  className = '',
  style,
  ...rest
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0, ...style }}
    {...rest}
  >
    {children}
  </svg>
);

export const GithubIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </IconBase>
);

export const MailIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </IconBase>
);

export const MapPinIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <circle cx="12" cy="10" r="3" />
  </IconBase>
);

export const TerminalIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </IconBase>
);

export const ArrowDownIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </IconBase>
);

export const ArrowUpIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </IconBase>
);

export const ArrowUpRightIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M7 7h10v10" />
    <path d="M7 17 17 7" />
  </IconBase>
);

export const ActivityIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2" />
  </IconBase>
);

export const CalculatorIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect width="16" height="20" x="4" y="2" rx="2" />
    <line x1="8" x2="16" y1="6" y2="6" />
    <line x1="16" x2="16" y1="14" y2="18" />
    <path d="M16 10h.01" />
    <path d="M12 10h.01" />
    <path d="M8 10h.01" />
    <path d="M12 14h.01" />
    <path d="M8 14h.01" />
    <path d="M12 18h.01" />
    <path d="M8 18h.01" />
  </IconBase>
);

export const MountainIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
  </IconBase>
);

export const ServerIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
    <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
    <line x1="6" x2="6.01" y1="6" y2="6" />
    <line x1="6" x2="6.01" y1="18" y2="18" />
  </IconBase>
);

export const CodeIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </IconBase>
);

export const GraduationCapIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
    <path d="M22 10v6" />
    <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
  </IconBase>
);

export const AwardIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </IconBase>
);
