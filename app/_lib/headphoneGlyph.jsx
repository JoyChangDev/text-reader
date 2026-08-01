// The placeholder headphone glyph shared by app/icon.js and app/apple-icon.js (a
// headband arc plus two ear cups) - one definition so the two sizes never drift from
// each other. Colors match this app's own "night" theme tokens (see
// app/_providers/chakra.jsx) rather than an arbitrary choice. See
// specs/phase-1-9-reader-route-restructure.md.
export function headphoneGlyph(glyphSize) {
  return (
    <svg width={glyphSize} height={glyphSize} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 13V11a8 8 0 0 1 16 0v2"
        stroke="#E8A961"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <rect x="2.5" y="12" width="5" height="7" rx="2.2" fill="#E8A961" />
      <rect x="16.5" y="12" width="5" height="7" rx="2.2" fill="#E8A961" />
    </svg>
  );
}
