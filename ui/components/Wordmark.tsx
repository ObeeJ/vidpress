/**
 * The brand wordmark for use inside running text.
 *
 * TheflateLogo (Navbar) is block-level and belongs to the header. This renders
 * the same mark inline so the dot lifts on hover wherever the brand is written,
 * not just in the nav.
 */
export default function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-prefix">the</span>
      <span className="wordmark-suffix">flate</span>
      <span className="wordmark-dot">.</span>
    </span>
  );
}
