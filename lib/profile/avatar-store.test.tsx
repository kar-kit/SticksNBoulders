import { render, screen } from "@testing-library/react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { forgetCircle } from "@/lib/auth/circle";
import { forgetAvatars } from "./avatar-cache";
import { AvatarUnavailable, removeMyAvatar, replaceMyAvatar } from "./avatar-store";
import { fetchProfile, forgetProfile } from "./profile-store";

/**
 * Replace and remove, against Appwrite faked at the network boundary. The
 * write helper, the policy, the namespace check and the profile read are the
 * real code. The fake keeps the two Appwrite rules that matter here: a file
 * stamped for a team the uploader is not in is refused, and a deleted file is
 * gone.
 */

const ME = "68e4a1c2003b5f7d9e10";
const PERMS = [`read("user:${ME}")`, `read("team:circle_${ME}")`, `update("user:${ME}")`, `delete("user:${ME}")`];

const server = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  files: new Map<string, { permissions: string[]; type: string }>(),
  circles: new Set<string>(),
  failProfileWrite: false,
  failDelete: false,
}));

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    client: {
      // The SDK's own authenticated request, which is how a picture is fetched.
      call: async (_method: string, url: URL) => {
        const fileId = /files\/([^/]+)\/view/.exec(url.pathname)?.[1] ?? "";
        if (!server.files.has(decodeURIComponent(fileId))) throw Object.assign(new Error("not found"), { code: 404 });
        return new ArrayBuffer(16);
      },
    },
    account: {
      get: async () => ({ $id: ME, name: "Joey Pang", email: "joey@example.com", prefs: {} }),
      createJWT: async () => ({ jwt: "jwt" }),
    },
    tables: {
      // The coach's rail read. Honours Query.select the way Appwrite does:
      // `$` attributes kept, every unselected data column dropped. A fake
      // that returned whole rows would hide a select that forgot a column.
      listRows: async ({ queries = [] }: { queries?: string[] }) => {
        if (!server.profile) return { total: 0, rows: [] };
        const select = queries.map((q) => JSON.parse(q) as { method: string; values?: string[] }).find((q) => q.method === "select");
        const keep = (key: string) => key.startsWith("$") || !select || (select.values ?? []).includes(key);
        const row = Object.fromEntries(Object.entries(server.profile).filter(([key]) => keep(key)));
        return { total: 1, rows: [row] };
      },
      getRow: async ({ rowId }: { rowId: string }) => {
        if (!server.profile || rowId !== ME) throw Object.assign(new Error("not found"), { code: 404 });
        return server.profile;
      },
      createRow: async (p: { rowId: string; data: Record<string, unknown>; permissions: string[] }) => {
        server.profile = { ...p.data, $id: p.rowId, $permissions: p.permissions };
        return server.profile;
      },
      updateRow: async (p: { rowId: string; data: Record<string, unknown>; permissions: string[] }) => {
        if (server.failProfileWrite) throw Object.assign(new Error("server error"), { code: 500 });
        server.profile = { ...server.profile, ...p.data, $permissions: p.permissions };
        return server.profile;
      },
    },
    storage: {
      getFileView: ({ bucketId, fileId }: { bucketId: string; fileId: string }) =>
        `https://appwrite.test/v1/storage/buckets/${bucketId}/files/${encodeURIComponent(fileId)}/view?project=p`,
      createFile: async (p: { bucketId: string; fileId: string; file: File; permissions: string[] }) => {
        for (const perm of p.permissions) {
          const team = /team:([^")]+)/.exec(perm)?.[1];
          if (team && !server.circles.has(team)) throw Object.assign(new Error("Permissions must be one of..."), { code: 401 });
        }
        if (p.bucketId !== "avatars") throw new Error(`wrong bucket ${p.bucketId}`);
        server.files.set(p.fileId, { permissions: p.permissions, type: p.file.type });
        return { $id: p.fileId };
      },
      deleteFile: async ({ bucketId, fileId }: { bucketId: string; fileId: string }) => {
        if (server.failDelete) throw new Error("network");
        if (bucketId !== "avatars") throw new Error(`wrong bucket ${bucketId}`);
        server.files.delete(fileId);
        return {};
      },
    },
  }),
}));

const webp = () => new Blob([new Uint8Array(2048)], { type: "image/webp" });

beforeEach(() => {
  forgetCircle();
  forgetProfile();
  forgetAvatars();
  server.profile = { $id: ME, user_id: ME, display_name: "Joey Pang", $permissions: PERMS };
  server.files = new Map();
  server.circles = new Set();
  server.failProfileWrite = false;
  server.failDelete = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/circle") server.circles.add(`circle_${ME}`);
      return new Response("{}", { status: 200 });
    }),
  );
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("uploads into the owner's namespace, stamped for them and their circle, and points the profile at it", async () => {
  const fileId = await replaceMyAvatar(webp(), "image/webp");

  expect(fileId).toMatch(new RegExp(`^${ME}_[a-z0-9]{8}$`));
  expect(server.files.get(fileId)?.permissions.sort()).toEqual([...PERMS].sort());
  expect(server.files.get(fileId)?.type).toBe("image/webp");
  expect((await fetchProfile(ME))?.avatarFileId).toBe(fileId);
});

it("deletes the old picture once the new one is in place", async () => {
  const first = await replaceMyAvatar(webp(), "image/webp");
  const second = await replaceMyAvatar(webp(), "image/webp");

  expect(second).not.toBe(first);
  expect([...server.files.keys()]).toEqual([second]);
  expect(server.profile?.avatar_file_id).toBe(second);
});

it("keeps the new picture when the old one cannot be deleted; the sweep reclaims it", async () => {
  const first = await replaceMyAvatar(webp(), "image/webp");
  server.failDelete = true;
  const second = await replaceMyAvatar(webp(), "image/webp");

  expect(server.profile?.avatar_file_id).toBe(second);
  expect([...server.files.keys()].sort()).toEqual([first, second].sort());
});

it("keeps the old face, and takes the new file back, when the profile cannot be repointed", async () => {
  const first = await replaceMyAvatar(webp(), "image/webp");
  server.failProfileWrite = true;

  await expect(replaceMyAvatar(webp(), "image/webp")).rejects.toThrow();
  expect(server.profile?.avatar_file_id).toBe(first);
  expect([...server.files.keys()]).toEqual([first]);
});

it("never deletes a file the profile names that is not the owner's own", async () => {
  // A row pointing outside its namespace (written by hand, not by the app)
  // reads as no picture, so replacing it must not try to delete somebody else's.
  const someoneElses = "68e4a1c2003b5f7d9e11_abc12345";
  server.files.set(someoneElses, { permissions: [], type: "image/webp" });
  server.profile = { ...server.profile, avatar_file_id: someoneElses };

  await replaceMyAvatar(webp(), "image/webp");

  expect(server.files.has(someoneElses)).toBe(true);
});

it("goes back to initials on remove, and deletes the file", async () => {
  const first = await replaceMyAvatar(webp(), "image/webp");
  await removeMyAvatar();

  expect(server.profile?.avatar_file_id).toBeNull();
  expect(server.files.has(first)).toBe(false);
});

it("refuses offline in a sentence, before touching anything", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  await expect(replaceMyAvatar(webp(), "image/webp")).rejects.toBeInstanceOf(AvatarUnavailable);
  expect(server.files.size).toBe(0);
});

it("reaches the coach: the rail's profile read carries the picture, and the face renders with the name as alt", async () => {
  // Uploaded by the athlete...
  const fileId = await replaceMyAvatar(webp(), "image/webp");
  // ...then a fresh page load on the coach's side, which knows nothing yet.
  forgetAvatars();
  expect(server.files.has(fileId)).toBe(true);

  const [athlete] = await fetchAthleteNames([ME]);
  expect(athlete).toMatchObject({ id: ME, name: "Joey Pang", avatarFileId: fileId });

  render(<UserAvatar userId={ME} name="Joey Pang" size={24} />);
  const img = await screen.findByRole("img", { name: "Joey Pang" });
  expect(img).toHaveAttribute("width", "24");
  expect(img).toHaveAttribute("loading", "lazy");
});

it("shows initials, not a broken image, for a picture that cannot be fetched", async () => {
  server.profile = { ...server.profile, avatar_file_id: `${ME}_gone1234` };
  await fetchAthleteNames([ME]);
  render(<UserAvatar userId={ME} name="Joey Pang" size={24} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("JP")).toBeInTheDocument();
});
