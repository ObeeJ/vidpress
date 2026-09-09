import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PoemFaq from "@/components/PoemFaq";
import Link from "next/link";

export const metadata = {
  title: "P.O.E.M & Vision | theflate",
  description: "Problem, Solution, Strategy: The foundational premise of theflate.",
};

export default function PoemPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000" }}>
      <Navbar />

      <main style={{ flex: 1, maxWidth: 900, width: "100%", margin: "0 auto", padding: "60px 20px 80px" }}>
        
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 9999, background: "#18181b", border: "1px solid #27272a", fontSize: 11, fontWeight: 700, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 16 }}>
            Startup Vision & Methodology
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-1.5px", color: "#ffffff", marginBottom: 16 }}>
            The P.O.E.M Framework
          </h1>
          <p style={{ fontSize: 16, color: "#a1a1aa", maxWidth: 640, margin: "0 auto 24px", lineHeight: 1.6 }}>
            Explosive growth is the fundamental prerequisite of a true startup. High inherent demand means the value created pulls the company forward.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <Link href="/" className="vpx-button-primary">
              Try theflate
            </Link>
            <Link href="/docs" className="vpx-button-secondary">
              View API Docs
            </Link>
          </div>
        </div>

        {/* Premise Box */}
        <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 12, padding: "28px 32px", marginBottom: 48 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#ffffff", marginBottom: 12 }}>
            The Fundamental Premise
          </h2>
          <p style={{ fontSize: 14, color: "#a1a1aa", lineHeight: 1.7, marginBottom: 16 }}>
            Before writing code or designing interfaces, we start with Vision: encapsulated by <strong style={{ color: "#ffffff" }}>P.O.E.M</strong>:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", marginBottom: 6 }}>1. Problem</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>Define the Pain & Audience</div>
              <div style={{ fontSize: 12, color: "#a1a1aa" }}>Who has the problem and what value would they place on a solution?</div>
            </div>
            <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", marginBottom: 6 }}>2. Solution</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>Compare with Status Quo</div>
              <div style={{ fontSize: 12, color: "#a1a1aa" }}>What is the solution and how does it crush how they solve it today?</div>
            </div>
            <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", textTransform: "uppercase", marginBottom: 6 }}>3. Strategy</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>Execution & Virality</div>
              <div style={{ fontSize: 12, color: "#a1a1aa" }}>How do you bring the solution to life and compound growth?</div>
            </div>
          </div>
        </div>

        {/* Full Interactive FAQ */}
        <PoemFaq showTitle={false} />

      </main>

      <Footer />
    </div>
  );
}
