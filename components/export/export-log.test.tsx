import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportLog } from "./export-log";

const exporter = vi.hoisted(() => ({
  buildTrainingLogExport: vi.fn(),
  deliverFile: vi.fn(),
}));
vi.mock("@/lib/export/export-log", () => exporter);

const profiles = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock("@/lib/profile/profile-store", () => profiles);

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ tables: {}, databaseId: "db" }),
}));

const built = (over: Record<string, unknown> = {}) => ({
  fileName: "sticksnboulders-joey-pang-2026-09-27.csv",
  parts: ["﻿Date\r\n"],
  setCount: 42,
  sessionCount: 3,
  skipped: 0,
  ...over,
});

beforeEach(() => {
  exporter.buildTrainingLogExport.mockReset();
  exporter.deliverFile.mockReset();
  exporter.deliverFile.mockResolvedValue(true);
  profiles.fetchProfile.mockResolvedValue({ displayName: "Joey Pang" });
});

describe("ExportLog", () => {
  it("exports the athlete's own log and hands it to the share sheet", async () => {
    exporter.buildTrainingLogExport.mockResolvedValue(built());
    render(<ExportLog athleteId="ath" athleteName="Joey Pang" audience="athlete" />);
    await userEvent.click(screen.getByRole("button", { name: "Export your training log" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Exported 42 sets from 3 sessions."));
    expect(exporter.buildTrainingLogExport).toHaveBeenCalledWith({}, "db", { id: "ath", name: "Joey Pang" });
    expect(exporter.deliverFile).toHaveBeenCalledWith(built().fileName, built().parts, { preferShare: true });
  });

  it("downloads rather than shares for a coach, naming the file from the profile", async () => {
    exporter.buildTrainingLogExport.mockResolvedValue(built());
    render(<ExportLog athleteId="ath" audience="coach" />);
    await userEvent.click(screen.getByRole("button", { name: "Export their training log" }));

    await waitFor(() => expect(exporter.deliverFile).toHaveBeenCalled());
    expect(profiles.fetchProfile).toHaveBeenCalledWith("ath");
    expect(exporter.buildTrainingLogExport).toHaveBeenCalledWith({}, "db", { id: "ath", name: "Joey Pang" });
    expect(exporter.deliverFile.mock.calls[0][2]).toEqual({ preferShare: false });
  });

  it("says there is nothing yet instead of downloading an empty file", async () => {
    exporter.buildTrainingLogExport.mockResolvedValue(built({ setCount: 0, sessionCount: 0 }));
    render(<ExportLog athleteId="ath" athleteName="Joey" audience="athlete" />);
    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Nothing to export yet"));
    expect(exporter.deliverFile).not.toHaveBeenCalled();
  });

  it("claims nothing was exported when the share sheet is dismissed", async () => {
    exporter.buildTrainingLogExport.mockResolvedValue(built());
    exporter.deliverFile.mockResolvedValue(false);
    render(<ExportLog athleteId="ath" athleteName="Joey" audience="athlete" />);
    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(exporter.deliverFile).toHaveBeenCalled());
    // Settled and ready to try again, with no success line for a file that
    // never left the phone.
    await waitFor(() => expect(screen.getByRole("button", { name: "Export your training log" })).toBeEnabled());
    expect(screen.getByRole("status")).not.toHaveTextContent("Exported");
  });

  it("reports rows it could not read", async () => {
    exporter.buildTrainingLogExport.mockResolvedValue(built({ skipped: 1 }));
    render(<ExportLog athleteId="ath" athleteName="Joey" audience="athlete" />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 unreadable row was left out."));
  });

  it("fails quietly and can be retried", async () => {
    exporter.buildTrainingLogExport.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(built());
    render(<ExportLog athleteId="ath" athleteName="Joey" audience="athlete" />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not reach the server"));

    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Exported 42 sets"));
  });
});
