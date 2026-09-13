"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ID, Permission, Query, Role } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuth } from "@/lib/auth-context";
import { tablesDB, storage } from "@/lib/appwrite";
import { DATABASE_ID, TABLES, BUCKETS, FUNCTIONS } from "@/lib/constants";
import { callFunction } from "@/lib/call-function";
import { fetchPrivateFileUrl } from "@/lib/private-file";
import type { Sex, UnitPreference, Program, Profile } from "@/lib/types";
import PageSpinner from "@/components/PageSpinner";

export default function ProfilePage() {
  const { user, profile, loading } = useRequireAuth();
  const { signOut } = useAuth();
  const router = useRouter();

  const [coachCode, setCoachCode] = useState("");
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [hasProgram, setHasProgram] = useState(false);

  useEffect(() => {
    if (!user) return;
    tablesDB
      .listRows<Program>(DATABASE_ID, TABLES.programs, [
        Query.equal("athleteUserId", user.$id),
        Query.equal("active", true),
        Query.limit(1),
      ])
      .then((res) => setHasProgram(res.rows.length > 0));
  }, [user]);

  if (loading || !profile) return <PageSpinner />;

  async function linkCoach() {
    if (!coachCode.trim()) return;
    setLinkStatus(null);
    try {
      await callFunction(FUNCTIONS.coachInviteRedeem, { code: coachCode.trim() });
      setCoachCode("");
      setLinkStatus("Linked!");
    } catch (err) {
      setLinkStatus(err instanceof Error ? err.message : "Couldn't link with that code.");
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/sign-in");
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <h1 className="text-xl font-semibold">Profile & Settings</h1>

      <AccountSection key={`${profile.$id}-account`} userId={user!.$id} username={user!.name} email={user!.email} profile={profile} />

      <SettingsForm key={profile.$id} userId={user!.$id} profile={profile} />

      {hasProgram && (
        <Link
          href="/program"
          className="rounded-xl border border-border px-4 py-3 text-sm text-accent"
        >
          My Program →
        </Link>
      )}

      <Link href="/coach" className="rounded-xl border border-border px-4 py-3 text-sm text-accent">
        Coach Dashboard →
      </Link>

      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
        <span className="text-sm font-medium text-muted">Link with a coach</span>
        <div className="flex gap-2">
          <input
            value={coachCode}
            onChange={(e) => setCoachCode(e.target.value.toUpperCase())}
            placeholder="e.g. 9F2WZQRT"
            className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm uppercase tracking-widest outline-none focus:border-accent"
          />
          <button
            onClick={linkCoach}
            className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground"
          >
            Link
          </button>
        </div>
        {linkStatus && <p className="text-xs text-muted">{linkStatus}</p>}
      </section>

      <button
        onClick={handleSignOut}
        className="h-12 rounded-xl border border-danger/40 text-sm font-medium text-danger"
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * The account's `name` (the "username") comes from signup/OAuth and is left alone here --
 * `displayName` is the separate, user-editable name shown around the app, defaulting to
 * the username until changed.
 */
function AccountSection({
  userId,
  username,
  email,
  profile,
}: {
  userId: string;
  username: string;
  email: string;
  profile: Profile;
}) {
  const { refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName ?? username);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!profile.avatarFileId) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    fetchPrivateFileUrl(storage.getFileView(BUCKETS.avatars, profile.avatarFileId)).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setAvatarUrl(url);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profile.avatarFileId]);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const permissions = [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ];
      const uploaded = await storage.createFile(BUCKETS.avatars, ID.unique(), file, permissions);
      const previousFileId = profile.avatarFileId;
      await tablesDB.updateRow(DATABASE_ID, TABLES.profiles, userId, { avatarFileId: uploaded.$id });
      if (previousFileId) {
        await storage.deleteFile(BUCKETS.avatars, previousFileId).catch(() => {});
      }
      const url = await fetchPrivateFileUrl(storage.getFileView(BUCKETS.avatars, uploaded.$id));
      setAvatarUrl(url);
      await refreshProfile();
    } finally {
      setUploading(false);
    }
  }

  async function saveDisplayName() {
    if (!displayName.trim()) return;
    setSavingName(true);
    try {
      await tablesDB.updateRow(DATABASE_ID, TABLES.profiles, userId, {
        displayName: displayName.trim(),
      });
      await refreshProfile();
    } finally {
      setSavingName(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4">
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-xl font-semibold text-muted disabled:opacity-60"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, per-user Appwrite file URL; not a next/image-optimizable asset
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (displayName || username || "?").charAt(0).toUpperCase()
          )}
        </button>
        <div className="flex flex-col">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-left text-sm text-accent disabled:opacity-60"
          >
            {uploading ? "Uploading…" : "Change photo"}
          </button>
          <p className="text-xs text-muted">@{username}</p>
          <p className="text-xs text-muted">{email}</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoChange}
          className="hidden"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Display name</span>
        <div className="flex gap-2">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={saveDisplayName}
            disabled={savingName}
            className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {savingName ? "…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Mounted with key={profile.$id} by the parent, so `profile` is guaranteed non-null and
 * stable for this component's lifetime -- local state can seed from it directly with no
 * effect needed to keep sex/unitPreference in sync with the loaded profile.
 */
function SettingsForm({ userId, profile }: { userId: string; profile: Profile }) {
  const { refreshProfile } = useAuth();
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [unitPreference, setUnitPreference] = useState<UnitPreference>(profile.unitPreference);
  const [saving, setSaving] = useState(false);

  async function saveSettings() {
    setSaving(true);
    try {
      await tablesDB.updateRow(DATABASE_ID, TABLES.profiles, userId, { sex, unitPreference });
      await refreshProfile();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <span className="text-sm font-medium text-muted">Sex</span>
      <div className="flex gap-3">
        {(["male", "female"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setSex(option)}
            className={`flex-1 rounded-xl border py-2.5 text-sm capitalize ${
              sex === option ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <span className="mt-2 text-sm font-medium text-muted">Units</span>
      <div className="flex gap-3">
        {(["kg", "lb"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setUnitPreference(option)}
            className={`flex-1 rounded-xl border py-2.5 text-sm uppercase ${
              unitPreference === option
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <button
        onClick={saveSettings}
        disabled={saving}
        className="mt-2 h-11 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
