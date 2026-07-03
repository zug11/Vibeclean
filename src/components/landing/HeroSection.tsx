import type { RefObject } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HERO } from "./copy";
import SchemaShowcase from "./SchemaShowcase";

const GRADIENT_PHRASE = "survive contact with reality.";
const h1Prefix = HERO.h1Line2.replace(GRADIENT_PHRASE, "").trimEnd();

interface HeroSectionProps {
  /** Reserves the space the big brand logo occupies before it flies to the topbar. */
  logoSlotRef: RefObject<HTMLDivElement>;
  /** Reduced motion: render the logo statically in the slot instead of flying it. */
  showStaticLogo: boolean;
  /** Play the intro video in the logo slot; crossfades into the SVG logo when done. */
  introVideo: boolean;
  onIntroEnd: () => void;
}

const HeroSection = ({ logoSlotRef, showStaticLogo, introVideo, onIntroEnd }: HeroSectionProps) => (
  <section className="relative overflow-hidden px-6 pb-20 pt-12 md:pb-28 md:pt-16">
    <div className="landing-grid-bg pointer-events-none absolute inset-0" />
    <div className="pointer-events-none absolute left-1/2 top-[26rem] h-[38rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(46,184,137,0.13),transparent_60%)] blur-2xl" />

    <div className="relative mx-auto max-w-4xl text-center">
      <div ref={logoSlotRef} className="relative mx-auto mb-8 h-36 w-[129px] md:mb-12 md:h-52 md:w-[186px]">
        {showStaticLogo && <img src="/vibedb-logo.svg" alt="VibeDB" className="h-full w-full" />}
        <AnimatePresence>
          {introVideo && (
            <motion.video
              key="intro"
              autoPlay
              muted
              playsInline
              preload="auto"
              onEnded={onIntroEnd}
              onError={onIntroEnd}
              exit={{ opacity: 0, transition: { duration: 0.6, ease: "easeOut" as const } }}
              // The logo artwork fills only ~46.5% of the square video frame,
              // centered at (46.8%, 49.1%) — oversize and offset it so the
              // in-video logo lands exactly on the SVG logo it crossfades into.
              // mix-blend-screen keeps the frame's black margins from occluding
              // the headline below (black-on-black passes through).
              className="absolute left-1/2 top-1/2 h-[215%] w-auto max-w-none -translate-x-[46.8%] -translate-y-[49.1%] mix-blend-screen"
              aria-hidden="true"
            >
              <source src="/vibedb-intro.webm" type="video/webm" />
              {/* error on the last <source> = all sources failed (the event does
                  not bubble to the <video> element itself) */}
              <source src="/vibedb-intro.mp4" type="video/mp4" onError={onIntroEnd} />
            </motion.video>
          )}
        </AnimatePresence>
      </div>
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
