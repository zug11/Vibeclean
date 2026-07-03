import { useEffect, useRef, useState } from "react";
import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import ProblemSection from "@/components/landing/ProblemSection";
import SolutionSection from "@/components/landing/SolutionSection";
import PipelineSection from "@/components/landing/PipelineSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import ClosingSection from "@/components/landing/ClosingSection";
import LandingFooter from "@/components/landing/LandingFooter";
import { FlyingLogo, useScrollBrand } from "@/components/landing/ScrollBrand";

const INTRO_TIMEOUT_MS = 12_000;

const LandingPage = () => {
  const heroSlotRef = useRef<HTMLDivElement>(null);
  const navMarkRef = useRef<HTMLDivElement>(null);
  const brand = useScrollBrand(heroSlotRef, navMarkRef);

  const [introDone, setIntroDone] = useState(false);
  const introVideo = !brand.staticMode && !introDone;

  // End the intro early if the user starts scrolling, and cap it in case the
  // video stalls or never fires `ended`.
  useEffect(() => {
    if (!introVideo) return;
    const onScroll = () => {
      if (window.scrollY > 60) setIntroDone(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const timeout = window.setTimeout(() => setIntroDone(true), INTRO_TIMEOUT_MS);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timeout);
    };
  }, [introVideo]);

  return (
    <div className="min-h-screen overflow-x-clip bg-black font-mazzard text-white antialiased selection:bg-vibe-green/30">
      <LandingNav markRef={navMarkRef} lockupOpacity={brand.lockupOpacity} />
      <main>
        <HeroSection
          logoSlotRef={heroSlotRef}
          showStaticLogo={brand.staticMode}
          introVideo={introVideo}
          onIntroEnd={() => setIntroDone(true)}
        />
        <ProblemSection />
        <SolutionSection />
        <PipelineSection />
        <FeaturesSection />
        <HowItWorksSection />
        <ClosingSection />
      </main>
      <LandingFooter />
      <FlyingLogo brand={brand} visible={!introVideo} />
    </div>
  );
};

export default LandingPage;
