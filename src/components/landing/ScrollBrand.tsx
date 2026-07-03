import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";

interface BrandMetrics {
  /** Hero slot, document coordinates (top) / viewport coordinates (left). */
  heroTop: number;
  heroLeft: number;
  heroW: number;
  /** Nav mark dock target, viewport coordinates (nav is sticky, so constant). */
  dockTop: number;
  dockLeft: number;
  dockW: number;
  /** Scroll distance over which the flight completes. */
  d: number;
}

export interface ScrollBrand {
  ready: boolean;
  staticMode: boolean;
  heroW: number;
  x: MotionValue<number>;
  y: MotionValue<number>;
  scale: MotionValue<number>;
  flyOpacity: MotionValue<number>;
  lockupOpacity: MotionValue<number> | number;
}

// easeOut so the dock-pull outpaces the page scroll early — otherwise the
// logo gets carried above the viewport mid-flight before settling.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Drives the hero logo → topbar flight: the big stacked logo sits in the hero
 * slot at the top of the page and, as the user scrolls, shrinks and glides to
 * the nav's V mark, crossfading into the horizontal lockup.
 */
export function useScrollBrand(
  heroSlotRef: RefObject<HTMLDivElement>,
  navMarkRef: RefObject<HTMLDivElement>,
): ScrollBrand {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const [m, setM] = useState<BrandMetrics | null>(null);

  const measure = useCallback(() => {
    const hero = heroSlotRef.current;
    const mark = navMarkRef.current;
    if (!hero || !mark) return;
    const hr = hero.getBoundingClientRect();
    const mr = mark.getBoundingClientRect();
    const heroTop = hr.top + window.scrollY;
    setM({
      heroTop,
      heroLeft: hr.left,
      heroW: hr.width,
      dockTop: mr.top,
      dockLeft: mr.left,
      dockW: mr.width,
      d: Math.max(280, heroTop + hr.height - mr.top),
    });
  }, [heroSlotRef, navMarkRef]);

  useLayoutEffect(() => {
    measure();
    const hero = heroSlotRef.current;
    const ro = new ResizeObserver(measure);
    if (hero) ro.observe(hero);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, heroSlotRef]);

  const progress = useTransform(scrollY, (s) => (m ? clamp01(s / m.d) : 0));

  const x = useTransform(scrollY, (s) => {
    if (!m) return 0;
    const q = easeOutCubic(clamp01(s / m.d));
    return m.heroLeft + (m.dockLeft - m.heroLeft) * q;
  });

  // Un-docked, the logo scrolls with the page (heroTop - s); docked, it pins to the nav.
  const y = useTransform(scrollY, (s) => {
    if (!m) return 0;
    const q = easeOutCubic(clamp01(s / m.d));
    const inFlow = m.heroTop - s;
    return inFlow + (m.dockTop - inFlow) * q;
  });

  const scale = useTransform(scrollY, (s) => {
    if (!m) return 1;
    const q = easeOutCubic(clamp01(s / m.d));
    return 1 + (m.dockW / m.heroW - 1) * q;
  });

  const flyOpacity = useTransform(progress, [0, 0.82, 0.98], [1, 1, 0]);
  const lockupOpacityMV = useTransform(progress, [0, 0.8, 0.96], [0, 0, 1]);

  return {
    ready: m !== null,
    staticMode: !!reduce,
    heroW: m?.heroW ?? 0,
    x,
    y,
    scale,
    flyOpacity,
    lockupOpacity: reduce ? 1 : lockupOpacityMV,
  };
}

/**
 * The fixed-position logo that flies from the hero slot into the topbar.
 * `visible` gates the intro handoff: hidden while the intro video plays,
 * fading in as the video fades out.
 */
export const FlyingLogo = ({ brand, visible = true }: { brand: ScrollBrand; visible?: boolean }) => {
  if (brand.staticMode || !brand.ready) return null;
  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-[60]"
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <motion.img
        src="/vibedb-logo.svg"
        alt=""
        aria-hidden="true"
        style={{
          width: brand.heroW,
          x: brand.x,
          y: brand.y,
          scale: brand.scale,
          opacity: brand.flyOpacity,
          transformOrigin: "top left",
        }}
      />
    </motion.div>
  );
};
