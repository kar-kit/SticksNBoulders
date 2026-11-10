import { ConnectionsScreen } from "./connections-screen";

export const metadata = { title: "Connections — Sticks N Boulders" };

/** Reached from Me, for allowlisted users only (F29). Not a tab. */
export default function ConnectionsPage() {
  return <ConnectionsScreen />;
}
