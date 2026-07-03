import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HERO } from "./copy";
import SchemaShowcase from "./SchemaShowcase";

const GRADIENT_PHRASE = "survive contact with reality.";
const h1Prefix = HERO.h1Line2.replace(GRADIENT_PHRASE, "").trimEnd();

const HeroSection = () => (
  <section className="relative overflow-hidden px-6 pb-20 pt-16 md:pb-28 md:pt-24">
    <div className="landing-grid-bg pointer-events-none absolute inset-0" />
    <div className="pointer-events-none absolute left-1/2 top-[26rem] h-[38rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(46,184,137,0.13),transparent_60%)] blur-2xl" />

    <div className="relative mx-auto max-w-4xl text-center">
      <h1 className="text-balance text-4xl leading-[1.08] tracking-tight sm:text-5xl lg:text-[64px]">
        <span className="block font-semibold text-white/70">{HERO.h1Line1}</span>
        <span className="mt-2 block font-extrabold">
          {h1Prefix}{" "}
          <span className="bg-gradient-to-r from-vibe-green to-vibe-orange bg-clip-text text-transparent">
            {GRADIENT_PHRASE}
          </span>
        </span>
      </h1>

      <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-white/60">{HERO.p1}</p>
      <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-white/60">{HERO.p2}</p>
      <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-white/80">
        {HERO.p3a} <span className="text-white">{HERO.p3b}</span>
      </p>

      <div className="mt-10">
        <Button
          asChild
          size="lg"
          className="gap-2 bg-vibe-green font-semibold text-black shadow-[0_0_50px_-10px_rgba(46,184,137,0.5)] hover:bg-vibe-green/90 focus-visible:ring-vibe-green/60 focus-visible:ring-offset-black"
        >
          <Link to="/app">
            {HERO.cta} <ArrowRight size={16} />
          </Link>
        </Button>
      </div>
    </div>

    <div className="relative mx-auto mt-14 max-w-5xl md:mt-20">
      <div className="rounded-2xl border border-white/10 bg-[#050706] p-3 md:p-5">
        <SchemaShowcase />
      </div>
    </div>
  </section>
);

export default HeroSection;
