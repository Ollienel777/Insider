import { ArrowRight } from "lucide-react";
import { LAYERS, LayerDot } from "@/components/shell/layer-dot";
import type { DataToLevelRow } from "./data-to-level";
import { Reveal } from "./reveal";

/**
 * One row of the Data → Level table (DESIGN.md, the provenance thread): the
 * layer dot and name, the field in mono, its value, the rule in plain words,
 * then what the level got from it. Before it fills, a skeleton holds its place.
 */
export function ProvenanceRow({ row, shown }: { row: DataToLevelRow; shown: boolean }) {
  return (
    <tr data-testid="provenance-row" data-rule={row.id} data-shown={shown} className="border-t border-border align-top">
      <td className="py-2 pr-3 pl-4">
        <Reveal shown={shown} skeleton="bar">
          <span className="flex items-center gap-2 text-sm text-text-2">
            <LayerDot layer={row.layer} decorative />
            {LAYERS[row.layer].label}
          </span>
        </Reveal>
      </td>
      <td className="py-2 pr-3">
        <Reveal shown={shown} skeleton="bar">
          <span className="font-mono text-sm break-words text-text-2">{row.field}</span>
        </Reveal>
      </td>
      <td className="py-2 pr-3">
        <Reveal shown={shown} skeleton="bar">
          <span className="font-mono text-sm text-text-1">{row.value}</span>
        </Reveal>
      </td>
      <td className="py-2 pr-4">
        <Reveal shown={shown} skeleton="lines">
          <span className="block text-sm text-text-2">{row.rule}</span>
          <span className="mt-1 flex gap-2 text-sm font-medium text-text-1">
            <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 stroke-[1.5] text-text-3" />
            <span>{row.result}</span>
          </span>
        </Reveal>
      </td>
    </tr>
  );
}
