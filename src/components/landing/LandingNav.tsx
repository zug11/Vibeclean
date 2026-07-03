import type { RefObject } from "react";
import { Link } from "react-router-dom";
import { motion, type MotionValue } from "framer-motion";
import { Button } from "@/components/ui/button";
import VibeDBMark from "./VibeDBMark";

interface LandingNavProps {
  /** Dock target for the flying hero logo — wraps the V mark. */
  markRef: RefObject<HTMLDivElement>;
  /** 0 while the big hero logo is on screen; 1 once it has docked. */
  lockupOpacity: MotionValue<number> | number;
}

const LandingNav = ({ markRef, lockupOpacity }: LandingNavProps) => (
  <nav className="sticky top-0 z-50 border-b border-white/[0.08] bg-black/70 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
      <motion.div style={{ opacity: lockupOpacity }} className="flex items-center gap-2.5">
        <div ref={markRef} className="h-7">
          <VibeDBMark className="h-7 w-auto" />
        </div>
        <span className="text-[17px] font-semibold tracking-tight">
          vibe<span className="text-vibe-orange">DB</span>
          <span className="bg-gradient-to-r from-vibe-orange to-vibe-green bg-clip-text text-transparent">.me</span>
        </span>
      </motion.div>
      <Button
        asChild
        size="sm"
        className="border border-white/15 bg-transparent text-white hover:bg-white/10 focus-visible:ring-vibe-green/60 focus-visible:ring-offset-black"
      >
        <Link to="/app">Go to App</Link>
      </Button>
    </div>
  </nav>
);

export default LandingNav;
