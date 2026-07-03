import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";
import { CLOSING } from "./copy";

const ClosingSection = () => (
  <section className="relative overflow-hidden border-t border-white/[0.08] px-6 py-24 md:py-32">
    <div className="pointer-events-none absolute bottom-0 left-1/2 h-[30rem] w-[60rem] -translate-x-1/2 translate-y-1/3 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(46,184,137,0.12),transparent_60%)] blur-2xl" />

    <div className="relative mx-auto max-w-3xl text-center">
      <Reveal>
        <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">
          {CLOSING.heading}
        </h2>
      </Reveal>

      <Reveal delay={0.05}>
        <p className="mt-8 text-lg leading-relaxed text-white/60">{CLOSING.p1}</p>
        <p className="mt-4 text-lg leading-relaxed text-white/60">{CLOSING.p2}</p>
        <p className="mt-4 text-lg leading-relaxed text-white/80">
          {CLOSING.p3a} <span className="text-white">{CLOSING.p3b}</span>
        </p>
      </Reveal>

      <Reveal>
        <p className="mt-14 text-xl font-medium text-white/70">{CLOSING.lead}</p>
      </Reveal>

      <div className="mt-6 flex flex-wrap justify-center gap-x-3 gap-y-2 text-2xl font-extrabold tracking-tight md:text-4xl">
        {CLOSING.imperatives.map((word, i) => (
          <Reveal key={word} delay={0.15 + i * 0.12}>
            <span
              className={cn(
                i === CLOSING.imperatives.length - 1 &&
                  "bg-gradient-to-r from-vibe-green to-vibe-orange bg-clip-text text-transparent",
              )}
            >
              {word}
            </span>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.2}>
        <div className="mt-12">
          <Button
            asChild
            size="lg"
            className="gap-2 bg-vibe-green font-semibold text-black shadow-[0_0_50px_-10px_rgba(46,184,137,0.5)] hover:bg-vibe-green/90 focus-visible:ring-vibe-green/60 focus-visible:ring-offset-black"
          >
            <Link to="/app">
              {CLOSING.cta} <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      </Reveal>
    </div>
  </section>
);

export default ClosingSection;
