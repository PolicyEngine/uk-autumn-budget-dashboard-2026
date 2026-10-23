/**
 * The replication line above the site footer: the repository, and the
 * policyengine.py version this build's uv.lock pins (read in
 * next.config.ts). A missing version is left out, never guessed.
 */
const REPO = "PolicyEngine/uk-autumn-budget-dashboard-2026";

export function replicationParts({ policyengine } = {}) {
  return policyengine ? [`policyengine.py ${policyengine}`] : [];
}

function ReplicationLine() {
  const parts = replicationParts({
    policyengine: process.env.NEXT_PUBLIC_POLICYENGINE_VERSION,
  });
  return (
    <p className="replication-line">
      Replication code:{" "}
      <a href={`https://github.com/${REPO}`} target="_blank" rel="noopener noreferrer">
        {REPO}
      </a>
      {parts.map((part) => (
        <span key={part}>
          {" · "}
          {part}
        </span>
      ))}
    </p>
  );
}

export default ReplicationLine;
