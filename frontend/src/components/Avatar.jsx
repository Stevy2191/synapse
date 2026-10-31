// A person's picture (or their initial), and a workspace's picture (or its emoji).

export function displayName(user) {
  return user?.display_name || user?.username || '';
}

export function UserAvatar({ user, size = 28, style }) {
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', display: 'block',
    ...style,
  };
  if (user?.avatar) return <img src={user.avatar} alt="" style={base} />;
  return (
    <span style={{
      ...base, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700,
      fontSize: Math.round(size * 0.42), fontFamily: 'var(--font-sans)',
      background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
    }}>
      {displayName(user)?.[0]?.toUpperCase() || '?'}
    </span>
  );
}

export function WorkspaceIcon({ workspace, size = 22, style }) {
  const base = { width: size, height: size, borderRadius: Math.round(size * 0.28), flexShrink: 0, ...style };
  if (workspace?.icon_image) return <img src={workspace.icon_image} alt="" style={{ ...base, objectFit: 'cover', display: 'block' }} />;
  return (
    <span style={{ ...base, display: 'grid', placeItems: 'center', fontSize: Math.round(size * 0.6), background: 'var(--accent-subtle)' }}>
      {workspace?.icon || '📁'}
    </span>
  );
}

export function workspaceSettings(workspace) {
  try { return JSON.parse(workspace?.settings || '{}'); } catch { return {}; }
}
