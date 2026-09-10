import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Link from "next/link";

export const metadata = {
  title: "P.O.E.M & Vision | theflate",
  description: "Problem, Solution, Strategy: The foundational premise of theflate.",
};

export default function PoemPage() {
  return (
    <div className="page-shell">
      <Navbar />

      <main className="page-prose page-prose-wide">

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-1.5px", color: "var(--color-fg)", marginBottom: 16 }}>
            The P.O.E.M Framework
          </h1>
          <p style={{ fontSize: 16, color: "var(--color-fg-2)", maxWidth: 640, margin: "0 auto 24px", lineHeight: 1.6 }}>
            Explosive growth is the fundamental prerequisite of a true startup. High inherent demand means the value created pulls the company forward.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <Link href="/" className="btn-primary">
              Try theflate
            </Link>
            <Link href="/docs" className="btn-secondary">
              View API Docs
            </Link>
          </div>
        </div>

        {/* Premise Box */}
        <div className="card" style={{ padding: "28px 32px", marginBottom: 48 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--color-fg)", marginBottom: 12 }}>
            The Fundamental Premise
          </h2>
          <p style={{ fontSize: 14, color: "var(--color-fg-2)", lineHeight: 1.7, marginBottom: 16 }}>
            Before writing code or designing interfaces, we start with Vision: encapsulated by <strong style={{ color: "var(--color-fg)" }}>P.O.E.M</strong>:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {[
              { step: "1. Problem", title: "Define the Pain & Audience", body: "Who has the problem and what value would they place on a solution?" },
              { step: "2. Solution", title: "Compare with Status Quo", body: "What is the solution and how does it crush how they solve it today?" },
              { step: "3. Strategy", title: "Execution & Virality", body: "How do you bring the solution to life and compound growth?" },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-line)", borderRadius: 8, padding: 16 }}>
                <div className="label" style={{ marginBottom: 6 }}>{step}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-fg)", marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 12, color: "var(--color-fg-2)" }}>{body}</div>
              </div>
            ))}
          </div>
        </div>


      </main>

      <Footer />
    </div>
  );
}
