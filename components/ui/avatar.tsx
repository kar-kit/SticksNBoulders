/* eslint-disable @next/next/no-img-element -- a blob: URL made in this page; next/image cannot optimise it */
import { initialsFor } from "@/lib/profile/initials";
import { cn } from "@/lib/cn";

/**
 * A person's picture, or their initials.
 *
 * The initials are always rendered underneath and the picture laid over them,
 * so a picture that is slow, missing or offline never leaves a hole -- and the
 * box is a fixed size either way, so nothing shifts when a face arrives.
 *
 * Square with the chip radius rather than a circle, matching the initials
 * block the coach header already drew.
 */
export interface AvatarProps {
  name: string;
  /** Something an `<img>` can show, or null for initials only. */
  src: string | null;
  /** Edge in CSS pixels. */
  size: number;
  className?: string;
}

export function Avatar({ name, src, size, className }: AvatarProps) {
  return (
    <span
      className={cn(
        "relative inline-flex flex-none items-center justify-center overflow-hidden rounded-chip bg-surface-2 font-semibold text-muted",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
    >
      {/* The initials are decoration once a picture is there; the picture's
          alt carries the name. With no picture they are the name's stand-in
          and are hidden from assistive tech either way, because every place
          an avatar sits also prints the name beside it. */}
      <span aria-hidden>{initialsFor(name)}</span>
      {src ? (
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}
