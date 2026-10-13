import { titleCase, statusTone } from '../lib/format';

export default function StatusBadge({ status }) {
  return <span className={`chip ${statusTone(status)}`}>{titleCase(status)}</span>;
}
