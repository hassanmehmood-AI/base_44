"use server";

import { revalidatePath } from "next/cache";
import * as activeCampaignsService from "@/server/services/activeCampaigns";
import { UnauthorizedError } from "@/server/services/authorization";

export type ActionResult = { error?: string; ok?: true };

export async function createAssignedContactAction(input: {
  companyId: string;
  name: string;
  businessName: string;
  phone: string;
  email: string;
}): Promise<ActionResult> {
  try {
    await activeCampaignsService.createAssignedContact(input);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { error: "You don't have access to that company." };
    if (e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath("/campanas-activas");
  return { ok: true };
}
