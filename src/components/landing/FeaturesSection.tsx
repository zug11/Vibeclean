import { Database, Layers, RefreshCw, ShieldCheck, Terminal, Workflow, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import BorderGlow from "./BorderGlow";
import Reveal from "./Reveal";
import { FEATURES } from "./copy";

const ICONS = [ShieldCheck, Workflow, Zap, RefreshCw, Terminal, Database, Layers];

const spanClass = (i: number) => {
  if (i === 0) return "md:col-span-2 lg:col-span-2";
  if (i === 6) return "lg:col-span-2";
  return "";
};

const FeaturesSection = () => (
  <section className="border-t border-white/[0.08] px-6 py-24 md:py-32">
    <div className="mx-auto max-w-6xl">
      <Reveal>
        <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-[44px] md:leading-tight">
          {FEATURES.heading}
        </h2>
      </Reveal>

      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.cards.map((card, i) => {
          const Icon = ICONS[i];
          const green = i % 2 === 0;
          return (
            <Reveal key={card.title} delay={(i % 3) * 0.07} className={cn("h-full", spanClass(i))}>
              <BorderGlow className="h-full" borderRadius={20} backgroundColor="#0a0c0b">
                <div className="flex h-full flex-col p-6 md:p-7">
                  <div
                    className={cn(
                      "mb-5 flex h-10 w-10 items-center justify-center rounded-xl",
                      green ? "bg-vibe-green/10 text-vibe-green" : "bg-vibe-orange/10 text-vibe-orange",
                    )}
                  >
                    <Icon size={19} />
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">{card.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-white/55">{card.text}</p>
                </div>
              </BorderGlow>
            </Reveal>
          );
        })}
      </div>
    </div>
  </section>
);

export default FeaturesSection;
