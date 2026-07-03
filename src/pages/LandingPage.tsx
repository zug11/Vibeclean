import { useRef } from "react";
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

const LandingPage = () => {
  const heroSlotRef = useRef<HTMLDivElement>(null);
  const navMarkRef = useRef<HTMLDivElement>(null);
  const brand = useScrollBrand(heroSlotRef, navMarkRef);

  return (
    <div className="min-h-screen overflow-x-clip bg-black font-mazzard text-white antialiased selection:bg-vibe-green/30">
      <LandingNav markRef={navMarkRef} lockupOpacity={brand.lockupOpacity} />
      <main>
        <HeroSection logoSlotRef={heroSlotRef} showStaticLogo={brand.staticMode} />
        <ProblemSection />
        <SolutionSection />
        <PipelineSection />
        <FeaturesSection />
        <HowItWorksSection />
        <ClosingSection />
      </main>
      <LandingFooter />
      <FlyingLogo brand={brand} />
    </div>
  );
};

export default LandingPage;
