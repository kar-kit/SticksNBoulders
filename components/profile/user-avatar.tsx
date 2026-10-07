"use client";

import { Avatar } from "@/components/ui/avatar";
import { useAvatarFile, useAvatarUrl } from "@/lib/profile/avatar-cache";

/**
 * The `Avatar` for a user id, looked up in the registry that profile reads
 * fill (lib/profile/avatar-cache.ts). Renders initials until -- and unless --
 * a picture is known and has loaded.
 */
export function UserAvatar({ userId, name, size, className }: { userId: string | null; name: string; size: number; className?: string }) {
  const fileId = useAvatarFile(userId);
  const src = useAvatarUrl(fileId);
  return <Avatar name={name} src={src} size={size} className={className} />;
}
