import { render, screen, waitFor } from "@testing-library/react";
import { ClipThumb } from "./clip-thumb";

const cache = vi.hoisted(() => ({ posterUrl: vi.fn<(id: string) => Promise<string | null>>() }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    storage: { getFileView: ({ fileId }: { fileId: string }) => `https://aw.test/v1/storage/files/${fileId}/view` },
    client: {
      call: async (_m: string, url: URL) => {
        const result = await cache.posterUrl(url.pathname);
        if (result === null) throw Object.assign(new Error("not found"), { code: 404 });
        return new ArrayBuffer(8);
      },
    },
  }),
}));

beforeEach(() => {
  cache.posterUrl.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:poster");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("ClipThumb", () => {
  it("shows the camera placeholder for a clip with no poster, and asks for nothing", () => {
    render(<ClipThumb posterId={null} label="Squat clip" />);
    expect(screen.getByRole("img", { name: "Squat clip" })).toHaveAttribute("data-clip-thumb", "placeholder");
    expect(cache.posterUrl).not.toHaveBeenCalled();
  });

  it("swaps in the poster once it has loaded", async () => {
    cache.posterUrl.mockResolvedValue("ok");
    render(<ClipThumb posterId="clip-a_poster" label="Squat clip" />);
    await waitFor(() => expect(screen.getByRole("img", { name: "Squat clip" })).toHaveAttribute("data-clip-thumb", "poster"));
    expect(document.querySelector("img")).toHaveAttribute("src", "blob:poster");
  });

  it("stays on the placeholder when the poster cannot be read", async () => {
    cache.posterUrl.mockResolvedValue(null);
    render(<ClipThumb posterId="clip-b_poster" />);
    await waitFor(() => expect(cache.posterUrl).toHaveBeenCalled());
    expect(document.querySelector("[data-clip-thumb]")).toHaveAttribute("data-clip-thumb", "placeholder");
    expect(document.querySelector("img")).toBeNull();
  });
});
