import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  Database, Check, Sparkles, Zap, ArrowRight, Loader2,
  CreditCard, Crown, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";

const TIERS = {
  standard: {
    name: "Standard",
    price: "$10",
    priceId: "price_1Sz07HIkHcWxU80Sf99HLTW7",
    productId: "prod_Twtvm5lU8EdiOJ",
    credits: 50,
    icon: Star,
    popular: false,
    features: [
      "50 AI credits/month",
      "Visual schema designer",
      "SQL & code export",
      "One-click deploy",
      "Schema audit & inspection",
    ],
  },
  pro: {
    name: "Pro",
    price: "$25",
    priceId: "price_1Sz07YIkHcWxU80S16hNMMOL",
    productId: "prod_Twtv0SUsLKMn2D",
    credits: 150,
    icon: Crown,
    popular: true,
    features: [
      "150 AI credits/month",
      "Everything in Standard",
      "Priority AI generation",
      "Batch schema commands",
      "Advanced query playground",
    ],
  },
};

const TOPUP = {
  credits: 100,
  price: "$8",
  pricePerCredit: "$0.08",
};

const CREDIT_COSTS = [
  { action: "Generate Schema", cost: 3 },
  { action: "Batch Command", cost: 3 },
  { action: "Schema Inspection", cost: 2 },
  { action: "SQL Export", cost: 1 },
  { action: "Mock Data", cost: 1 },
  { action: "Query Generation", cost: 1 },
  { action: "Smart Column Suggestion", cost: 1 },
];

const PricingPage = () => {
  const { user, subscription, refreshSubscription } = useAuth();
  const navigate = useNavigate();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingTopup, setLoadingTopup] = useState(false);

  const handleSubscribe = async (tier: keyof typeof TIERS) => {
    if (!user) {
      navigate("/auth");
      return;
    }
    setLoadingTier(tier);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: TIERS[tier].priceId, mode: "subscription" },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      console.error("Checkout error:", err);
    } finally {
      setLoadingTier(null);
    }
  };

  const handleTopup = async () => {
    if (!user) {
      navigate("/auth");
      return;
    }
    setLoadingTopup(true);
    try {
      const { data, error } = await supabase.functions.invoke("buy-credits");
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      console.error("Top-up error:", err);
    } finally {
      setLoadingTopup(false);
    }
  };

  const handleManage = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      console.error("Portal error:", err);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Database size={18} className="text-primary" />
            </div>
            <span className="text-lg font-bold">VibeDB</span>
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                {subscription.subscribed && (
                  <Button variant="outline" size="sm" onClick={handleManage}>
                    Manage Subscription
                  </Button>
                )}
                <Button size="sm" asChild>
                  <Link to="/app">Go to App</Link>
                </Button>
              </>
            ) : (
              <Button size="sm" asChild>
                <Link to="/auth">Sign In</Link>
              </Button>
            )}
          </div>
        </div>
      </nav>

      {/* Header */}
      <section className="px-6 py-16 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-4xl font-bold md:text-5xl">
            Simple, credit-based <span className="gradient-text">pricing</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Subscribe for monthly access and credits. Need more? Top up anytime.
          </p>
        </motion.div>

        {/* Current status */}
        {user && subscription.subscribed && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-auto mt-6 inline-flex items-center gap-3 rounded-full border border-accent/30 bg-accent/5 px-5 py-2"
          >
            <Zap size={16} className="text-accent" />
            <span className="text-sm font-medium">
              {subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)} plan · {subscription.credits} credits remaining
            </span>
          </motion.div>
        )}
      </section>

      {/* Plans */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className="grid gap-6 md:grid-cols-2">
          {(Object.entries(TIERS) as [keyof typeof TIERS, typeof TIERS[keyof typeof TIERS]][]).map(([key, tier]) => {
            const isCurrentPlan = subscription.tier === key;
            const Icon = tier.icon;
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: key === "pro" ? 0.1 : 0 }}
                className={`relative rounded-2xl border p-6 ${
                  tier.popular
                    ? "border-primary bg-card shadow-glow"
                    : "border-border bg-card"
                } ${isCurrentPlan ? "ring-2 ring-accent" : ""}`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                    Most Popular
                  </div>
                )}
                {isCurrentPlan && (
                  <div className="absolute -top-3 right-4 rounded-full bg-accent px-3 py-0.5 text-xs font-bold text-accent-foreground">
                    Your Plan
                  </div>
                )}

                <div className="mb-4 flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tier.popular ? "bg-primary/10" : "bg-secondary"}`}>
                    <Icon size={20} className={tier.popular ? "text-primary" : "text-foreground"} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{tier.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold">{tier.price}</span>
                      <span className="text-sm text-muted-foreground">/month</span>
                    </div>
                  </div>
                </div>

                <div className="mb-6 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                  <Sparkles size={14} className="mr-1 inline text-primary" />
                  <span className="font-semibold">{tier.credits} AI credits</span> included monthly
                </div>

                <ul className="mb-6 space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={16} className="mt-0.5 shrink-0 text-accent" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full gap-2"
                  variant={tier.popular ? "default" : "outline"}
                  disabled={isCurrentPlan || loadingTier === key}
                  onClick={() => handleSubscribe(key)}
                >
                  {loadingTier === key ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : isCurrentPlan ? (
                    "Current Plan"
                  ) : (
                    <>Subscribe <ArrowRight size={14} /></>
                  )}
                </Button>
              </motion.div>
            );
          })}
        </div>

        {/* Top-up */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <CreditCard size={24} className="text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Need more credits?</h3>
                <p className="text-sm text-muted-foreground">
                  {TOPUP.credits} credits for {TOPUP.price} ({TOPUP.pricePerCredit}/credit)
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleTopup}
              disabled={loadingTopup || !subscription.subscribed}
              className="gap-2"
            >
              {loadingTopup ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              Buy Credits
            </Button>
          </div>
          {!subscription.subscribed && user && (
            <p className="mt-3 text-xs text-muted-foreground">Subscribe to a plan first, then top up as needed.</p>
          )}
        </motion.div>

        {/* Credit costs table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 rounded-2xl border border-border bg-card p-6"
        >
          <h3 className="mb-4 text-lg font-bold">Credit costs per action</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CREDIT_COSTS.map((item) => (
              <div key={item.action} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2">
                <span className="text-sm">{item.action}</span>
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  {item.cost} {item.cost === 1 ? "credit" : "credits"}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-primary" />
            <span>VibeDB</span>
          </div>
          <span>© {new Date().getFullYear()} VibeDB. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
};

export default PricingPage;
