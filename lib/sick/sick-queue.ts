"use client";

import { enqueue } from "@/lib/offline/client";

/**
 * Sending call-ins (F31), like every other write an athlete makes
 * (docs/offline.md): written to the device the moment it is tapped, and sent
 * to Appwrite behind it when there is signal. Apart from sick-store.ts so the
 * coach's screens, which only read, never load the offline queue.
 */

export interface CallInInput {
  sickId: string;
  startsOn: string;
  endsOn: string;
  note: string | null;
}

/** Queues a call-in. Resolves once it is written to the device, not once Appwrite has it. */
export async function queueCallInSick(input: CallInInput): Promise<void> {
  await enqueue("sick.create", { ...input });
}

/** Queues the end of one call-in: shortened to `endsOn`, or deleted when that is null. */
export async function queueEndSick(sickId: string, endsOn: string | null): Promise<void> {
  await enqueue("sick.end", { sickId, endsOn });
}
