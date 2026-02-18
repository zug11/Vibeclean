import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const TIERS: Record<string, { name: string; monthlyCredits: number }> = {
  "prod_Twtvm5lU8EdiOJ": { name: "standard", monthlyCredits: 50 },
  "prod_Twtv0SUsLKMn2D": { name: "pro", monthlyCredits: 150 },
};
const TOPUP_CREDITS = 100;

serve(async (req) => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (webhookSecret && sig) {
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return new Response("Webhook signature verification failed", { status: 400 });
    }
  } else {
    event = JSON.parse(body) as Stripe.Event;
  }

  console.log(`Processing event: ${event.type}`);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      const type = session.metadata?.type;

      if (!userId) {
        console.error("No user_id in metadata");
        return new Response("OK", { status: 200 });
      }

      if (type === "topup") {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("ai_credits")
          .eq("user_id", userId)
          .maybeSingle();

        const currentCredits = profile?.ai_credits ?? 0;
        await supabaseAdmin.from("profiles").update({
          ai_credits: currentCredits + TOPUP_CREDITS,
        }).eq("user_id", userId);

        console.log(`Added ${TOPUP_CREDITS} credits to user ${userId}`);
      }
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("user_id, ai_credits, subscription_tier")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (profile && invoice.billing_reason === "subscription_cycle") {
        const sub = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
        if (sub.data.length > 0) {
          const productId = sub.data[0].items.data[0].price.product as string;
          const tierInfo = TIERS[productId];
          if (tierInfo) {
            await supabaseAdmin.from("profiles").update({
              ai_credits: profile.ai_credits + tierInfo.monthlyCredits,
              subscription_tier: tierInfo.name,
            }).eq("user_id", profile.user_id);
            console.log(`Renewed ${tierInfo.monthlyCredits} credits for user ${profile.user_id}`);
          }
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;

      await supabaseAdmin.from("profiles").update({
        subscription_tier: "none",
      }).eq("stripe_customer_id", customerId);

      console.log(`Subscription canceled for customer ${customerId}`);
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }

  return new Response("OK", { status: 200 });
});
