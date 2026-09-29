import { TIDE_RULES_COPY } from "./tide";

export function TideRules({
  className = "field__hint",
}: {
  className?: string;
}) {
  return <p className={className}>{TIDE_RULES_COPY}</p>;
}
