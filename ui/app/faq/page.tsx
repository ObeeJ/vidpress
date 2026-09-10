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
      <main className="page-prose page-prose-wide">
        <PoemFaq showTitle={true} />
      </main>
      <Footer />
    </div>
  );
}
