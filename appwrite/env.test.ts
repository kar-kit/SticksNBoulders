import { publicAppwriteConfig, serverAppwriteConfig } from "./env";

const complete = {
  NEXT_PUBLIC_APPWRITE_ENDPOINT: "https://appwrite.example.com/v1",
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: "abc123",
  NEXT_PUBLIC_APPWRITE_DATABASE_ID: "sticksnboulders",
  APPWRITE_API_KEY: "secret",
};

describe("Appwrite config", () => {
  it("reads the endpoint from the environment, never a constant", () => {
    // The Cloud migration in January 2027 has to be a config change.
    expect(publicAppwriteConfig(complete).endpoint).toBe("https://appwrite.example.com/v1");
  });

  it("keeps the API key out of the client config entirely", () => {
    expect(publicAppwriteConfig(complete)).not.toHaveProperty("apiKey");
    expect(serverAppwriteConfig(complete).apiKey).toBe("secret");
  });

  it.each(["NEXT_PUBLIC_APPWRITE_ENDPOINT", "NEXT_PUBLIC_APPWRITE_PROJECT_ID", "NEXT_PUBLIC_APPWRITE_DATABASE_ID"])(
    "refuses to start without %s",
    (key) => {
      const partial = { ...complete, [key]: undefined };
      expect(() => publicAppwriteConfig(partial)).toThrow(/Appwrite config is invalid or missing/);
    },
  );

  it("names what is missing, so the error is actionable", () => {
    expect(() => publicAppwriteConfig({ ...complete, NEXT_PUBLIC_APPWRITE_PROJECT_ID: undefined })).toThrow(
      /projectId/,
    );
  });

  it("rejects an endpoint that is not a URL rather than failing at the first request", () => {
    expect(() => publicAppwriteConfig({ ...complete, NEXT_PUBLIC_APPWRITE_ENDPOINT: "localhost:80" })).toThrow();
  });

  it("requires the key on the server but not the client", () => {
    const noKey = { ...complete, APPWRITE_API_KEY: undefined };
    expect(() => publicAppwriteConfig(noKey)).not.toThrow();
    expect(() => serverAppwriteConfig(noKey)).toThrow(/apiKey/);
  });
});

describe("endpoint validation", () => {
  it.each([
    ["localhost:80", "a host:port pair parses as a URL with protocol 'localhost:'"],
    ["appwrite.example.com/v1", "no scheme at all"],
    ["ftp://appwrite.example.com/v1", "wrong scheme"],
    ["", "empty"],
  ])("rejects %j — %s", (endpoint) => {
    expect(() => publicAppwriteConfig({ ...complete, NEXT_PUBLIC_APPWRITE_ENDPOINT: endpoint })).toThrow();
  });

  it.each([
    "https://appwrite.jp-homelab.work/v1",
    "http://localhost/v1",
    "https://cloud.appwrite.io/v1",
  ])("accepts %j", (endpoint) => {
    expect(publicAppwriteConfig({ ...complete, NEXT_PUBLIC_APPWRITE_ENDPOINT: endpoint }).endpoint).toBe(endpoint);
  });
});
