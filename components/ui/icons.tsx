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

/** A line chart on two axes: the exercise header's link to /lift/[id] progress and records. */
export const ProgressIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 3v14h14M6.5 12.5l3-3.5 2.5 2 4-5" />
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

/** A delete or remove: the exercise header's Remove, a swiped row's reveal. */
export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 5.5h14M8 5.5V3.5h4v2M5 5.5l.8 11a1.5 1.5 0 0 0 1.5 1.5h5.4a1.5 1.5 0 0 0 1.5-1.5l.8-11M8.5 9v5.5M11.5 9v5.5" />
  </Icon>
);

/** The athlete's note on a set (F11): the mark on a logged row, the edit sheet's Note cell. */
export const NoteIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 3.5h12a1 1 0 0 1 1 1v8.5l-4.5 3.5H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M12.5 16.5v-3.5H17M6.5 7.5h7M6.5 10.5h4" />
  </Icon>
);
