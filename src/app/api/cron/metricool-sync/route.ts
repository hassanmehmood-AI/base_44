import { NextRequest, NextResponse } from "next/server";
import * as companySocialAccountsRepo from "@/server/repositories/companySocialAccounts";
import * as socialService from "@/server/services/social";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

const METRICOOL_PLATFORMS = ["METRICOOL_INSTAGRAM", "METRICOOL_FACEBOOK"];

/** Scheduled sync — Metricool's Inbox has no webhook (its own docs say
 * messages must be checked manually/polled; see integrations/metricool.ts),
 * so an external scheduler must call this on an interval (e.g. every 2–5
 * minutes). This app deploys on Railway, not Vercel, so there's no built-in
 * Vercel Cron — use Railway's own cron/scheduled-job feature, a GitHub
 * Actions scheduled workflow, or an external pinger (cron-job.org, etc.).
 *
 * Protected by a shared secret (CRON_SECRET) rather than a user session,
 * since nothing here is tied to a logged-in user — same reasoning as
 * api/webhooks/meta bypassing proxy.ts's login redirect (see proxy.ts's
 * matcher). Unlike that real webhook, there's no inbound signature to
 * verify here (we're the ones calling Metricool, not the reverse), so this
 * route authenticates itself instead and fails closed if CRON_SECRET isn't
 * set — never runs "open" by accident. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const accounts = await companySocialAccountsRepo.listByPlatforms(METRICOOL_PLATFORMS);
  const results: Array<{
    accountId: string;
    companyId: string;
    ok: boolean;
    conversationsSeen?: number;
    messagesAdded?: number;
    error?: string;
  }> = [];

  for (const account of accounts) {
    try {
      const result = await socialService.syncMetricoolConversations(account);
      results.push({ accountId: account.id, companyId: account.companyId, ok: true, ...result });
    } catch (e) {
      const message =
        e instanceof ProviderNotConfiguredError ? e.message : e instanceof Error ? e.message : "Unknown error";
      results.push({ accountId: account.id, companyId: account.companyId, ok: false, error: message });
      console.error(`[metricool sync] account ${account.id} (company ${account.companyId}) failed:`, e);
    }
  }

  return NextResponse.json({ accountsSynced: accounts.length, results });
}
