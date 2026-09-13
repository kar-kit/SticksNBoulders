import { callFunction } from "../call-function";
import { functions } from "../appwrite";

jest.mock("../appwrite", () => ({
  functions: { createExecution: jest.fn() },
}));

const createExecution = functions.createExecution as jest.Mock;

describe("callFunction", () => {
  beforeEach(() => {
    createExecution.mockReset();
  });

  it("returns the parsed JSON body on a successful execution", async () => {
    createExecution.mockResolvedValue({
      responseStatusCode: 200,
      responseBody: JSON.stringify({ code: "ABC123" }),
    });

    const result = await callFunction<{ code: string }>("some-function", { teamId: "t1" });
    expect(result).toEqual({ code: "ABC123" });
  });

  it("calls createExecution with a JSON-stringified body and POST method", async () => {
    createExecution.mockResolvedValue({
      responseStatusCode: 200,
      responseBody: JSON.stringify({ ok: true }),
    });

    await callFunction("some-function", { foo: "bar" });

    expect(createExecution).toHaveBeenCalledTimes(1);
    const args = createExecution.mock.calls[0];
    expect(args[0]).toBe("some-function");
    expect(JSON.parse(args[1])).toEqual({ foo: "bar" });
  });

  it("throws the server's error message on a 4xx response", async () => {
    createExecution.mockResolvedValue({
      responseStatusCode: 400,
      responseBody: JSON.stringify({ error: "teamId is required" }),
    });

    await expect(callFunction("some-function", {})).rejects.toThrow("teamId is required");
  });

  it("throws the server's error message on a 5xx response", async () => {
    createExecution.mockResolvedValue({
      responseStatusCode: 500,
      responseBody: JSON.stringify({ error: "Failed to create invite code" }),
    });

    await expect(callFunction("some-function", {})).rejects.toThrow("Failed to create invite code");
  });

  it("throws a generic message when the response body isn't valid JSON", async () => {
    createExecution.mockResolvedValue({
      responseStatusCode: 200,
      responseBody: "not json at all",
    });

    await expect(callFunction("some-function", {})).rejects.toThrow("Request failed");
  });

  it("throws a generic message on an error response with no parseable error field", async () => {
    createExecution.mockResolvedValue({
      responseStatusCode: 500,
      responseBody: JSON.stringify({ somethingElse: true }),
    });

    await expect(callFunction("some-function", {})).rejects.toThrow("Request failed");
  });

  it("propagates a rejected createExecution call (e.g. network failure)", async () => {
    createExecution.mockRejectedValue(new Error("network down"));
    await expect(callFunction("some-function", {})).rejects.toThrow("network down");
  });
});
