// The Synapse logo. Served from /logo.svg (public/logo.svg, a copy of assets/logo.svg)
// so it's defined in one place and cached for offline use.
export default function Logo({ size = 24, style, ...rest }) {
  return (
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt="Synapse"
      draggable={false}
      style={{ display: 'block', flexShrink: 0, ...style }}
      {...rest}
    />
  );
}
