import { fetchPrivateFileUrl } from "../private-file";

describe("fetchPrivateFileUrl", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;

  beforeEach(() => {
    window.localStorage.clear();
    URL.createObjectURL = jest.fn(() => "blob:mock-url");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
  });

  it("fetches without the fallback header when no session is stored in localStorage", async () => {
    const mockBlob = new Blob(["data"]);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => mockBlob });

    await fetchPrivateFileUrl("https://appwrite.example/v1/storage/view");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://appwrite.example/v1/storage/view",
      { headers: undefined }
    );
  });

  it("attaches X-Fallback-Cookies from localStorage when a session is stored there", async () => {
    window.localStorage.setItem("cookieFallback", '{"a_session_123":"secret"}');
    const mockBlob = new Blob(["data"]);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => mockBlob });

    await fetchPrivateFileUrl("https://appwrite.example/v1/storage/view");

    expect(global.fetch).toHaveBeenCalledWith("https://appwrite.example/v1/storage/view", {
      headers: { "X-Fallback-Cookies": '{"a_session_123":"secret"}' },
    });
  });

  it("returns an object URL built from the response blob on success", async () => {
    const mockBlob = new Blob(["image-bytes"]);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => mockBlob });

    const url = await fetchPrivateFileUrl("https://appwrite.example/v1/storage/view");

    expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(url).toBe("blob:mock-url");
  });

  it("throws with the status code when the response is not ok (e.g. 401 guest)", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(fetchPrivateFileUrl("https://appwrite.example/v1/storage/view")).rejects.toThrow(
      "401"
    );
  });

  it("propagates a network-level fetch rejection", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));

    await expect(fetchPrivateFileUrl("https://appwrite.example/v1/storage/view")).rejects.toThrow(
      "network down"
    );
  });
});
