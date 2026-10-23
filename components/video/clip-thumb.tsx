"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon } from "@/components/ui/icons";
import { usePosterUrl } from "@/lib/video/poster-cache";
import { cn } from "@/lib/cn";

/**
 * A clip's thumbnail: its poster frame, or a camera placeholder (F12).
 *
 * The placeholder is not an error state. Every clip filmed before v17, every
 * clip whose phone could not grab a frame, and every poster still loading or
 * refused shows it, and it says the same true thing: there is a clip here.
 * The frame replaces it once loaded, in the same box, so nothing shifts.
 *
 * Fetched only once the box is near the screen, so a review rail of 300 clips
 * downloads the ones a coach can see, not all of them. Where the browser has
 * no IntersectionObserver (tests, very old engines) it loads straight away.
 *
 * Decorative by default: every place it appears already names the clip in
 * text, and a screen reader hearing "thumbnail" sixty times learns nothing.
 * Pass `label` where the thumbnail stands alone.
 */
export interface ClipThumbProps {
  /** From `posterOf(row)`: null when the clip has no poster. */
  posterId: string | null;
  className?: string;
  label?: string;
}

export function ClipThumb({ posterId, className, label }: ClipThumbProps) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (near || !posterId || !box.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [near, posterId]);

  const src = usePosterUrl(posterId, near);

  return (
    <span
      ref={box}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-clip-thumb={src ? "poster" : "placeholder"}
      className={cn(
        // No position utility, and callers add only size and position: cn
        // does not merge, so a conflicting class would fight these. To hide
        // it (the phone rail), wrap it.
        "flex flex-none items-center justify-center overflow-hidden rounded-chip border border-border bg-surface-2 text-muted-2",
        className,
      )}
    >
      {src ? (
        // A blob URL from the SDK's own authenticated read; next/image cannot
        // fetch it and has nothing to optimise in a 320px frame.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <CameraIcon width={14} height={14} />
      )}
    </span>
  );
}
