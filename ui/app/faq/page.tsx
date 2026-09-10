import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PoemFaq from "@/components/PoemFaq";

export const metadata = {
  title: "FAQ | theflate",
  description: "Frequently asked questions about theflate: compression, formats, API, pricing, and privacy.",
};

export default function FaqPage() {
  return (
    <div className="page-shell">
      <Navbar />
      <main style={{ flex: 1, maxWidth: 900, width: "100%", margin: "0 auto", padding: "60px 20px 80px" }}>
        <PoemFaq showTitle={true} />
      </main>
      <Footer />
    </div>
  );
}
