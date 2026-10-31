import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type cytoscape from 'cytoscape';
import { Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CareerGraphView, STATUS_STYLE } from '@/components/graph/CareerGraphView';
import { DemoBanner, EmptyState, ErrorState, LoadingState } from '@/components/shared/states';
import { useLatestAnalysis } from '@/services/api';
import type { CareerGraph, CytoNode } from '@/types/api';

type Status = NonNullable<CytoNode['status']>;
const ALL_STATUSES = Object.keys(STATUS_STYLE) as Status[];

export function NodeInspector({ graph, nodeId }: { graph: CareerGraph; nodeId: string | null }) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return <p className="text-sm text-muted">Select a node to see its details and connections.</p>;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const connections = graph.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const outgoing = e.source === node.id;
      const other = byId.get(outgoing ? e.target : e.source);
      return { id: e.id, type: e.type, outgoing, other: other?.label ?? '?' };
    });
  const style = STATUS_STYLE[node.status ?? 'implied'];
  const props = Object.entries(node.properties).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <div className="space-y-3 text-sm" data-testid="node-inspector">
      <div>
        <h3 className="text-base font-semibold">{node.label}</h3>
        <div className="mt-1 flex gap-1.5">
          <Badge variant="outline">{node.type}</Badge>
          <Badge style={{ backgroundColor: `${style.color}1a`, color: style.color }}>{style.label}</Badge>
        </div>
      </div>
      {props.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {props.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="break-words">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Connections ({connections.length})</p>
        <ul className="max-h-48 space-y-1 overflow-auto text-xs">
          {connections.map((c) => (
            <li key={c.id}>
              <span className="text-muted">{c.outgoing ? c.type + ' →' : '← ' + c.type}</span> {c.other}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function KnowledgeGraph() {
  const latest = useLatestAnalysis();
  const a = latest.data ?? null;
  const graph = a?.cytoscape;
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [hidden, setHidden] = useState<Set<Status>>(new Set());
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const present = useMemo(() => new Set((graph?.nodes ?? []).map((n) => n.status ?? 'implied')), [graph]);
  const counts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {};
    graph?.nodes.forEach((n) => {
      const s = n.status ?? 'implied';
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [graph]);
  const visible = useMemo(() => new Set(ALL_STATUSES.filter((s) => !hidden.has(s))), [hidden]);

  const toggle = (s: Status) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const zoom = (f: number) => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() * f, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  return (
    <>
      <PageHeader title="Knowledge Graph" description="The subgraph Neo4j returned for your analysis: you, your skills, the target role, prerequisites and courses." />
      {latest.isPending && <LoadingState label="Loading graph..." />}
      {latest.isError && <ErrorState error={latest.error} onRetry={() => latest.refetch()} />}
      {latest.isSuccess && !graph && (
        <EmptyState
          title="No graph available"
          description={a ? 'The Neo4j step did not produce a graph for the latest analysis.' : 'Run Analyze My Career from the dashboard to build your graph.'}
          action={<Link to="/" className="text-sm text-brand hover:underline">Go to Dashboard</Link>}
        />
      )}
      {a && graph && (
        <div className="space-y-4">
          <DemoBanner mode={a.mode} />
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <Input aria-label="Search graph" placeholder="Search nodes" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Zoom controls">
              <Button size="icon" variant="outline" aria-label="Zoom in" onClick={() => zoom(1.3)}><ZoomIn /></Button>
              <Button size="icon" variant="outline" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}><ZoomOut /></Button>
              <Button size="icon" variant="outline" aria-label="Fit to screen" onClick={() => cyRef.current?.fit(undefined, 30)}><Maximize2 /></Button>
            </div>
            <span className="text-xs text-muted">{graph.nodes.length} nodes · {graph.edges.length} relationships</span>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by node type">
            {ALL_STATUSES.filter((s) => present.has(s)).map((s) => {
              const on = visible.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${on ? 'border-border bg-white' : 'border-dashed border-slate-300 bg-slate-50 text-slate-400 line-through'}`}
                >
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: STATUS_STYLE[s].color }} />
                  {STATUS_STYLE[s].label} ({counts[s] ?? 0})
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="overflow-hidden lg:col-span-3">
              <CardContent className="p-0">
                <CareerGraphView
                  graph={graph}
                  height="min(70vh, 640px)"
                  visibleStatuses={visible}
                  search={search}
                  selectedId={selected}
                  onSelect={setSelected}
                  onReady={(cy) => (cyRef.current = cy)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>Click a node in the graph</CardDescription>
              </CardHeader>
              <CardContent>
                <NodeInspector graph={graph} nodeId={selected} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
