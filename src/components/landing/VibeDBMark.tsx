import { useId } from "react";

interface VibeDBMarkProps {
  className?: string;
}

/** The VibeDB "V" brand mark (orange + green strokes), cropped from the full logo. */
const VibeDBMark = ({ className = "h-7 w-auto" }: VibeDBMarkProps) => {
  const uid = useId();
  const g1 = `vdb-mark-1-${uid}`;
  const g2 = `vdb-mark-2-${uid}`;

  return (
    <svg viewBox="0 0 72.69 66" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient
          id={g1}
          x1=".82"
          y1="74.12"
          x2="38.84"
          y2="74.12"
          gradientTransform="translate(0 98.66) scale(1 -1)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ff7500" />
          <stop offset="1" stopColor="#ce4d00" />
        </linearGradient>
        <linearGradient
          id={g2}
          x1="23.28"
          y1="52.16"
          x2="72.54"
          y2="77.11"
          gradientTransform="translate(0 98.66) scale(1 -1)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fd8b1c" />
          <stop offset=".59" stopColor="#7fc26a" />
          <stop offset="1" stopColor="#2cc57e" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${g1})`}
        d="M37.09,41.73L17.29,5.03C15.69,2.13,12.89.33,9.79.13,3.99-.17-1.31,5.53.29,11.63c.2.8.7,1.7,1.2,2.6l16.3,29.7c3.9,8.5,15.3,5.2,19.3-2.2Z"
      />
      <path
        fill={`url(#${g2})`}
        d="M63.79,0c-2.8,0-5.9,1.6-7.7,4.6l-19.1,35.9c-1.6,2.7-4.3,7.6-10.4,7.7-2.5,0-5.9-.9-8.9-4.5l8.3,15.5c2.2,3.8,5.7,6.2,10.3,6.2,4.1,0,7.8-1.9,10-5.8l25.1-45.5c.8-1.5,1.3-2.5,1.3-4.9C72.69,4.1,68.29-.1,63.79,0Z"
      />
    </svg>
  );
};

export default VibeDBMark;
