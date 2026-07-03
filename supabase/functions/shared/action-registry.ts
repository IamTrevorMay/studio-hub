// Code Action Registry — maps handler slugs to TypeScript functions.
// Data-driven workflow steps reference these slugs instead of inline functions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ActionHandler = (
  ctx: Record<string, unknown>,
  payload: Record<string, unknown>,
  admin: SupabaseClient,
) => Promise<{ contextUpdates?: Record<string, unknown> }>;

// ─── Actor UUIDs (same as ad-read-workflow.ts) ──────────────
const TREVOR = "c3290048-436b-46c6-b3f0-fdf7923d0c3b";

// ─── Extracted handlers ─────────────────────────────────────

async function acceptProposal(
  ctx: Record<string, unknown>,
  admin: SupabaseClient,
): Promise<{
  sponsor_id: string;
  campaign_id: string;
  campaign_name: string;
  deliverables: Array<Record<string, unknown>>;
}> {
  const proposalId = ctx.proposal_id as string;
  const brandName = ctx.brand_name as string;

  // Fetch proposal + items
  const { data: proposal, error: pErr } = await admin
    .from("ad_read_proposals")
    .select(
      "*, items:ad_read_proposal_items(id, title, deliverable_type, channel, due_month, pay, position)",
    )
    .eq("id", proposalId)
    .single();
  if (pErr || !proposal) {
    throw new Error(`Proposal not found: ${pErr?.message}`);
  }

  // Idempotency guard — if already accepted, don't re-create sponsor/campaign/deliverables.
  // Best-effort: return the previously created sponsor + campaign so the return shape holds.
  if (proposal.status === "accepted") {
    const { data: sponsorRow } = await admin
      .from("sponsors")
      .select("id")
      .ilike("name", brandName)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sponsorRow) {
      const { data: existingCampaign } = await admin
        .from("sponsor_campaigns")
        .select("id, name")
        .eq("sponsor_id", sponsorRow.id)
        .ilike("name", brandName + " Campaign")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingCampaign) {
        const { data: delivs } = await admin
          .from("sponsor_deliverables")
          .select("id, title")
          .eq("campaign_id", existingCampaign.id);
        return {
          sponsor_id: sponsorRow.id,
          campaign_id: existingCampaign.id,
          campaign_name: existingCampaign.name,
          deliverables: (delivs || []).map((d) => ({
            deliverable_id: d.id,
            title: d.title,
          })),
        };
      }
    }
    // Prior campaign not locatable — still avoid inserting duplicates.
    return {
      sponsor_id: "",
      campaign_id: "",
      campaign_name: brandName + " Campaign",
      deliverables: [],
    };
  }

  // Find or create sponsor
  let sponsorId: string;
  const { data: existing } = await admin
    .from("sponsors")
    .select("id")
    .ilike("name", brandName)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    sponsorId = existing.id;
  } else {
    const { data: newSponsor, error: sErr } = await admin
      .from("sponsors")
      .insert({ name: brandName, created_by: TREVOR })
      .select()
      .single();
    if (sErr || !newSponsor) {
      throw new Error(`Failed to create sponsor: ${sErr?.message}`);
    }
    sponsorId = newSponsor.id;
  }

  // Build campaign payload
  const campaignPayload: Record<string, unknown> = {
    sponsor_id: sponsorId,
    name: brandName + " Campaign",
    description: proposal.description || null,
    payment_status: "unpaid",
  };
  const items = (proposal.items || []) as Array<Record<string, unknown>>;
  items.sort(
    (a, b) => ((a.position as number) || 0) - ((b.position as number) || 0),
  );

  const itemMonths = items
    .map((it) => it.due_month as string)
    .filter(Boolean)
    .sort();
  if (itemMonths.length > 0) {
    campaignPayload.start_date = itemMonths[0] + "-01";
    const lastM = itemMonths[itemMonths.length - 1];
    const [ly, lm] = lastM.split("-").map(Number);
    const endD = new Date(ly, lm, 0);
    campaignPayload.end_date = endD.toISOString().slice(0, 10);
  }

  const { data: newCampaign, error: cErr } = await admin
    .from("sponsor_campaigns")
    .insert(campaignPayload)
    .select()
    .single();
  if (cErr || !newCampaign) {
    throw new Error(`Failed to create campaign: ${cErr?.message}`);
  }

  // Create deliverables
  const deliverables: Array<Record<string, unknown>> = [];
  if (items.length > 0) {
    const delivRows = items.map((item) => ({
      sponsor_id: sponsorId,
      campaign_id: newCampaign.id,
      title: item.title,
      deliverable_type: item.deliverable_type,
      channel: item.channel || null,
      due_date: item.due_month ? item.due_month + "-01" : null,
      pay: item.pay ? parseFloat(String(item.pay)) : null,
      platforms: [],
      needs_review: false,
    }));
    const { data: createdDelivs, error: dErr } = await admin
      .from("sponsor_deliverables")
      .insert(delivRows)
      .select("id, title");
    if (dErr) console.error("Error creating deliverables:", dErr.message);
    if (createdDelivs) {
      for (const d of createdDelivs) {
        deliverables.push({ deliverable_id: d.id, title: d.title });
      }
    }
  }

  // Mark proposal accepted
  await admin
    .from("ad_read_proposals")
    .update({ status: "accepted" })
    .eq("id", proposalId);

  return {
    sponsor_id: sponsorId,
    campaign_id: newCampaign.id,
    campaign_name: newCampaign.name,
    deliverables,
  };
}

// ─── Registry ───────────────────────────────────────────────

export interface ActionRegistryEntry {
  handler: ActionHandler;
  description: string;
}

const ACTION_REGISTRY: Record<string, ActionRegistryEntry> = {
  "ad_read:accept_proposal": {
    description: "Accept an ad read proposal — creates sponsor, campaign, and deliverables",
    handler: async (ctx, _payload, admin) => {
      const result = await acceptProposal(ctx, admin);
      return {
        contextUpdates: {
          campaign_id: result.campaign_id,
          campaign_name: result.campaign_name,
          sponsor_id: result.sponsor_id,
          deliverables: result.deliverables,
        },
      };
    },
  },

  "ad_read:decline_proposal": {
    description: "Decline an ad read proposal — marks it as declined",
    handler: async (ctx, _payload, admin) => {
      await admin
        .from("ad_read_proposals")
        .update({ status: "declined" })
        .eq("id", ctx.proposal_id as string);
      return {};
    },
  },

  "ad_read:review_proposal": {
    description:
      "Review an ad read proposal — accepts or declines based on outcome",
    handler: async (ctx, payload, admin) => {
      const outcome = payload.outcome as string;
      if (outcome === "deny") {
        await admin
          .from("ad_read_proposals")
          .update({ status: "declined" })
          .eq("id", ctx.proposal_id as string);
        return {};
      }
      // Default to accept
      const result = await acceptProposal(ctx, admin);
      return {
        contextUpdates: {
          campaign_id: result.campaign_id,
          campaign_name: result.campaign_name,
          sponsor_id: result.sponsor_id,
          deliverables: result.deliverables,
        },
      };
    },
  },

  "ad_read:refresh_deliverables": {
    description:
      "Refresh the deliverables list from DB so fan-out picks up any added after proposal acceptance",
    handler: async (ctx, _payload, admin) => {
      const campaignId = ctx.campaign_id as string;
      if (!campaignId) return {};
      const { data: delivs } = await admin
        .from("sponsor_deliverables")
        .select("id, title")
        .eq("campaign_id", campaignId);
      if (delivs && delivs.length > 0) {
        return {
          contextUpdates: {
            deliverables: delivs.map((d) => ({
              deliverable_id: d.id,
              title: d.title,
            })),
          },
        };
      }
      return {};
    },
  },

  "mayday:film_send_handoff": {
    description:
      "Mayday video — when the editor's Contractors assignment is created, stash its id into context so the wait_on_edit step can match the assignment's completion",
    handler: async (_ctx, payload, _admin) => {
      const assignmentId = payload.editor_assignment_id as string | undefined;
      if (assignmentId) {
        return { contextUpdates: { editor_assignment_id: assignmentId } };
      }
      return {};
    },
  },

  "ad_read:set_video_event": {
    description:
      "Link a deliverable to a video event on the calendar",
    handler: async (_ctx, payload, admin) => {
      const deliverableId = payload.deliverable_id as string;
      const videoEventId = payload.video_event_id as string;
      if (deliverableId && videoEventId) {
        const { error } = await admin
          .from("sponsor_deliverables")
          .update({ video_event_id: videoEventId })
          .eq("id", deliverableId);
        if (error) {
          throw new Error(`Failed to set video_event_id: ${error.message}`);
        }
      }
      return {};
    },
  },
};

export function getActionHandler(slug: string): ActionHandler | null {
  return ACTION_REGISTRY[slug]?.handler || null;
}

export function listActionSlugs(): Array<{
  slug: string;
  description: string;
}> {
  return Object.entries(ACTION_REGISTRY).map(([slug, entry]) => ({
    slug,
    description: entry.description,
  }));
}
