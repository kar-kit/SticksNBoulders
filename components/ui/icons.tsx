import type { SVGProps } from "react";

/**
 * Icon paths lifted from the design canvas. 20x20, 1.5 stroke, currentColor
 * so a parent's text colour drives them -- the accent-line token is a legal
 * icon stroke, the accent-fill token is not.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const TodayIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="3.5" width="15" height="14" rx="2" />
    <path d="M2.5 8h15M6.5 2v3M13.5 2v3" />
  </Icon>
);

export const LogIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7v6M16 7v6M2 8.5v3M18 8.5v3M4 10h12" />
  </Icon>
);

export const HistoryIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 5.5V10l3 2" />
  </Icon>
);

export const MeIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="7" r="3.5" />
    <path d="M3.5 17c0-3.3 2.9-5 6.5-5s6.5 1.7 6.5 5" />
  </Icon>
);

/** Used both as the per-exercise film button and inside a video-required row. */
export const CameraIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.5" y="5" width="17" height="11.5" rx="2" />
    <circle cx="10" cy="10.75" r="3.25" />
    <path d="M6.5 5l1.2-2h4.6L13.5 5" />
  </Icon>
);
