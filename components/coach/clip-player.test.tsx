import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClipPlayer } from "./clip-player";

/**
 * What the player does when its URL stops working.
 *
 * The URL is a five-minute ticket the stream route checks on every Range
 * request, so a coach who stays on a clip -- 0.5x, looping, stepping frames --
 * hits a 404 on the first request after expiry, and the element fires
 * `error`. The parent owns the URL, so this harness plays the parent: it holds
 * `src` and swaps in whatever `mint` returns.
 */

const FIRST = "/api/clip/file-1?t=first";
const WOULD_NOT_PLAY = /This clip would not play/;

function Player({ mint }: { mint: () => Promise<string | null> }) {
  const [src, setSrc] = useState(FIRST);
  return (
    <ClipPlayer
      src={src}
      clipId="clip-1"
      refreshSrc={async () => {
        const next = await mint();
        if (next) setSrc(next);
        return next !== null;
      }}
    />
  );
}

const videoIn = (container: HTMLElement) => container.querySelector("video") as HTMLVideoElement;

beforeEach(() => {
  // jsdom has no media pipeline; play() is only observed, never run.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a ticket that expires while the clip is open", () => {
  it("asks for a fresh URL and keeps playing, rather than calling the clip broken", async () => {
    const mint = vi.fn(async () => "/api/clip/file-1?t=second");
    const { container } = render(<Player mint={mint} />);

    fireEvent.error(videoIn(container));

    await waitFor(() => expect(videoIn(container)).toHaveAttribute("src", "/api/clip/file-1?t=second"));
    expect(mint).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(WOULD_NOT_PLAY)).not.toBeInTheDocument();
  });

  it("lands back on the same moment, still playing", async () => {
    const { container } = render(<Player mint={async () => "/api/clip/file-1?t=second"} />);
    const element = videoIn(container);
    // Twelve seconds in and playing when the range request failed.
    Object.defineProperty(element, "currentTime", { value: 12, writable: true, configurable: true });
    Object.defineProperty(element, "paused", { value: false, configurable: true });

    fireEvent.error(element);
    await waitFor(() => expect(element).toHaveAttribute("src", "/api/clip/file-1?t=second"));
    element.currentTime = 0; // What a reload does.
    fireEvent.loadedMetadata(element);

    expect(element.currentTime).toBe(12);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  /**
   * Retry once, then believe it. A fresh ticket that fails before loading is
   * not expiry -- access was withdrawn, or the file is still uploading -- and
   * re-minting in a loop would hammer the route for a clip that will not come.
   */
  it("gives up when the fresh URL fails too, without asking again", async () => {
    const mint = vi.fn(async () => "/api/clip/file-1?t=second");
    const { container } = render(<Player mint={mint} />);

    fireEvent.error(videoIn(container));
    await waitFor(() => expect(videoIn(container)).toHaveAttribute("src", "/api/clip/file-1?t=second"));
    fireEvent.error(videoIn(container));

    expect(await screen.findByText(WOULD_NOT_PLAY)).toBeInTheDocument();
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("refreshes again on the next expiry, once the fresh URL has played", async () => {
    const mint = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("/api/clip/file-1?t=second")
      .mockResolvedValueOnce("/api/clip/file-1?t=third");
    const { container } = render(<Player mint={mint} />);

    fireEvent.error(videoIn(container));
    await waitFor(() => expect(videoIn(container)).toHaveAttribute("src", "/api/clip/file-1?t=second"));
    fireEvent.loadedMetadata(videoIn(container));

    // Another five minutes on the same clip.
    fireEvent.error(videoIn(container));
    await waitFor(() => expect(videoIn(container)).toHaveAttribute("src", "/api/clip/file-1?t=third"));
    expect(screen.queryByText(WOULD_NOT_PLAY)).not.toBeInTheDocument();
  });

  it("says the clip would not play when no fresh URL can be had", async () => {
    const { container } = render(<Player mint={async () => null} />);
    fireEvent.error(videoIn(container));
    expect(await screen.findByText(WOULD_NOT_PLAY)).toBeInTheDocument();
  });
});
