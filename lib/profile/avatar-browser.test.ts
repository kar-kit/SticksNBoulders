import { AVATAR_SIZE, browserPipeline, prepareAvatar } from "./avatar";

/**
 * The browser half of the pipeline: the two calls avatar.test.ts cannot make
 * in node. What is asserted is the wiring that decides whether a portrait
 * photo comes out upright and square -- the EXIF option on decode, and the
 * crop reaching drawImage -- not that a canvas can draw.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeCanvas(encodesAs: (type: string) => string) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage, imageSmoothingQuality: "low" }),
    toBlob: (done: (blob: Blob | null) => void, type: string) => done(new Blob([new Uint8Array(100)], { type: encodesAs(type) })),
  };
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : create(tag)) as typeof document.createElement);
  return { canvas, drawImage };
}

it("decodes with the photo's own orientation applied, so a portrait iPhone shot is upright", async () => {
  const decode = vi.fn(async () => ({ width: 3024, height: 4032, close: () => {} }));
  vi.stubGlobal("createImageBitmap", decode);
  fakeCanvas((type) => type);
  const file = new Blob([new Uint8Array(10)], { type: "image/jpeg" });

  await prepareAvatar(file, browserPipeline);

  expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
});

it("draws the centred square of the upright image into a 512px canvas", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 3024, height: 4032, close: () => {} }));
  const { canvas, drawImage } = fakeCanvas((type) => type);

  const prepared = await prepareAvatar(new Blob(), browserPipeline);

  expect(prepared.ok).toBe(true);
  expect([canvas.width, canvas.height]).toEqual([AVATAR_SIZE, AVATAR_SIZE]);
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 504, 3024, 3024, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
});

it("checks what the browser actually encoded, and moves to JPEG when WebP came back as PNG", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 600, close: () => {} }));
  // Safari before 17: asked for WebP, silently returns PNG.
  fakeCanvas((type) => (type === "image/webp" ? "image/png" : type));

  const prepared = await prepareAvatar(new Blob(), browserPipeline);

  expect(prepared).toMatchObject({ ok: true, type: "image/jpeg" });
});
