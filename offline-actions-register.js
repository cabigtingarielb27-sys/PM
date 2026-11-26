// Registers each queued action type with the real server function that processes
// it. Imported once for its side effects (in the authed layout) so the sync
// engine knows how to replay offline actions on reconnect.
import { registerAction } from "@/lib/offlineSync";
import { createSupportTicket } from "@/lib/server-fns";

registerAction("supportTicket", async (payload) => {
  return createSupportTicket({ data: payload });
});