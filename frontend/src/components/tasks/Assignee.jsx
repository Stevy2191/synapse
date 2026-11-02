// Who a to-do is assigned to: a small coloured circle with their initial (name on hover).
import { useStore } from '../../stores/useStore';
import { membersNow, personLabel } from '../../team/team';
import { colorFor } from '../../collab/session';

export function assigneeName(username, wsId) {
  const p = membersNow(wsId).find(m => m.username.toLowerCase() === username);
  return p ? personLabel(p) : username;
}

export default function Assignee({ username, withName = false }) {
  const wsId = useStore(s => s.activeWorkspace?.id);
  if (!username) return null;
  const name = assigneeName(username, wsId);
  return (
    <span className="assignee" title={`Assigned to ${name}`}>
      <span className="assignee-dot" style={{ background: colorFor(username) }}>{name.slice(0, 1).toUpperCase()}</span>
      {withName && <span className="assignee-name">{name}</span>}
    </span>
  );
}
