import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Database, Sparkles, FileCode2, ArrowRight, Layers, Wand2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" as const },
  }),
};

const features = [
  {
    icon: Layers,
    title: "Visual Schema Designer",
    description: "Drag, drop, and connect tables in a beautiful canvas. No SQL required to get started.",
  },
  {
    icon: Wand2,
    title: "AI-Powered Suggestions",
    description: "Describe your app and let AI generate the perfect schema — relationships, indexes, and all.",
  },
  {
    icon: Upload,
    title: "One-Click Deploy",
    description: "Push your schema straight to a live database with a single click. Instant backend.",
  },
  {
    icon: FileCode2,
    title: "Export Anywhere",
    description: "Generate SQL migrations, Prisma schemas, or Drizzle configs. Your schema, your stack.",
  },
];

const steps = [
  { num: "01", title: "Design", description: "Build your schema visually or with AI assistance." },
  { num: "02", title: "Generate", description: "Export to SQL, Prisma, Drizzle, or any format you need." },
  { num: "03", title: "Deploy", description: "Push to a live database with one click. Done." },
];

const LandingPage = () => {
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
          <Button size="sm" asChild>
            <Link to="/app">Go to App</Link>
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-24 md:py-36">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ background: "var(--gradient-hero)" }} />
        <div className="relative mx-auto max-w-3xl text-center">
          <motion.div
            custom={0}
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <Sparkles size={14} className="text-primary" />
            AI-powered schema design · Free to use
          </motion.div>

          <motion.h1
            custom={1}
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="text-4xl font-bold leading-tight tracking-tight md:text-6xl"
          >
            Design databases visually.{" "}
            <span className="gradient-text">Deploy instantly.</span>
          </motion.h1>

          <motion.p
            custom={2}
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground"
          >
            VibeDB is the visual schema designer that turns your ideas into production-ready databases — powered by AI, deployed in seconds.
          </motion.p>

          <motion.div
            custom={3}
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            className="mt-8"
          >
            <Button size="lg" className="gap-2 shadow-glow" asChild>
              <Link to="/app">
                Get Started <ArrowRight size={16} />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/50 px-6 py-20 md:py-28">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14 text-center"
          >
            <h2 className="text-3xl font-bold md:text-4xl">Everything you need to ship fast</h2>
            <p className="mt-3 text-muted-foreground">From idea to deployed database in minutes, not days.</p>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                className="group rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                  <f.icon size={20} className="text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border/50 px-6 py-20 md:py-28">
        <div className="mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14 text-center"
          >
            <h2 className="text-3xl font-bold md:text-4xl">Three steps to a live database</h2>
          </motion.div>

          <div className="grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <motion.div
                key={s.num}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                className="text-center"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <span className="gradient-text text-xl font-bold">{s.num}</span>
                </div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/50 px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-10 text-center shadow-lg md:p-14"
        >
          <h2 className="text-2xl font-bold md:text-3xl">Ready to build your database?</h2>
          <p className="mt-3 text-muted-foreground">Start designing your schema for free — powered by AI.</p>
          <Button size="lg" className="mt-6 gap-2 shadow-glow" asChild>
            <Link to="/app">
              Get Started <ArrowRight size={16} />
            </Link>
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-primary" />
            <span>VibeDB</span>
          </div>
          <span>&copy; {new Date().getFullYear()} VibeDB. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
