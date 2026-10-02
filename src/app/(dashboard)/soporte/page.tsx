import { auth } from "@/auth";
import * as ticketsService from "@/server/services/tickets";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";
import { SoporteClient } from "./SoporteClient";

export default async function SoportePage() {
  const [session, tickets, companies] = await Promise.all([
    auth(),
    ticketsService.listTicketsForCurrentUser(),
    getAllowedCompaniesForCurrentUser(),
  ]);

  const initialSelectedId = tickets[0]?.id ?? null;
  const initialDetail = initialSelectedId ? await ticketsService.getTicket(initialSelectedId) : undefined;

  return (
    <SoporteClient
      tickets={tickets}
      companies={companies}
      initialSelectedId={initialSelectedId}
      initialMessages={initialDetail?.messages ?? []}
      currentUserId={session!.user.id}
    />
  );
}
