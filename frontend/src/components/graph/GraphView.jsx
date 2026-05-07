import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '../../stores/useStore';
import api from '../../api';
import toast from 'react-hot-toast';

export default function GraphView() {
  const svgRef = useRef(null);
  const { activeWorkspace, activeNote, setActiveNote } = useStore(s => ({
    activeWorkspace: s.activeWorkspace,
    activeNote: s.activeNote,
    setActiveNote: s.setActiveNote
  }));
  const [graphData, setGraphData] = useState(null);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    if (!activeWorkspace) return;
    api.get(`/notes/workspace/${activeWorkspace.id}/graph`).then(({ data }) => {
      setGraphData(data);
    }).catch(() => toast.error('Failed to load graph'));
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!graphData || !svgRef.current) return;

    const { nodes, edges } = graphData;
    if (nodes.length === 0) return;

    const container = svgRef.current.parentElement;
    const W = container.clientWidth;
    const H = container.clientHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', W)
      .attr('height', H);

    const g = svg.append('g');

    // Zoom
    svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', e => g.attr('transform', e.transform)));

    // Simulation
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(120).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(40));

    // Gradient defs
    const defs = svg.append('defs');
    const grad = defs.append('radialGradient').attr('id', 'nodeGrad');
    grad.append('stop').attr('offset', '0%').attr('stop-color', 'var(--accent-hover)');
    grad.append('stop').attr('offset', '100%').attr('stop-color', 'var(--accent)');

    const activeGrad = defs.append('radialGradient').attr('id', 'activeGrad');
    activeGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f0f');
    activeGrad.append('stop').attr('offset', '100%').attr('stop-color', 'var(--accent)');

    // Links
    const link = g.append('g').selectAll('line')
      .data(edges).enter().append('line')
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    // Node groups
    const node = g.append('g').selectAll('g')
      .data(nodes).enter().append('g')
      .attr('class', 'graph-node')
      .style('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Node circles
    node.append('circle')
      .attr('r', d => {
        const connCount = edges.filter(e => e.source === d.id || e.target === d.id || e.source?.id === d.id || e.target?.id === d.id).length;
        return Math.max(10, Math.min(24, 10 + connCount * 3));
      })
      .attr('fill', d => activeNote?.note?.id === d.id ? 'url(#activeGrad)' : 'url(#nodeGrad)')
      .attr('stroke', d => activeNote?.note?.id === d.id ? '#fff' : 'var(--accent)')
      .attr('stroke-width', d => activeNote?.note?.id === d.id ? 3 : 1)
      .style('filter', 'drop-shadow(0 0 8px var(--accent))')
      .on('click', async (e, d) => {
        try {
          const { data } = await api.get(`/notes/${d.id}`);
          setActiveNote(data);
        } catch {}
      })
      .on('mouseenter', (e, d) => {
        setHovered(d);
        d3.select(e.currentTarget).attr('stroke-width', 3).style('filter', 'drop-shadow(0 0 16px var(--accent-hover))');
      })
      .on('mouseleave', (e, d) => {
        setHovered(null);
        d3.select(e.currentTarget).attr('stroke-width', activeNote?.note?.id === d.id ? 3 : 1).style('filter', 'drop-shadow(0 0 8px var(--accent))');
      });

    // Labels
    node.append('text')
      .text(d => d.title.length > 20 ? d.title.slice(0, 20) + '…' : d.title)
      .attr('dy', d => {
        const connCount = edges.filter(e => e.source === d.id || e.target === d.id || e.source?.id === d.id || e.target?.id === d.id).length;
        return Math.max(10, Math.min(24, 10 + connCount * 3)) + 16;
      })
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-secondary)')
      .attr('font-size', 11)
      .attr('font-family', 'var(--font-sans)')
      .style('pointer-events', 'none');

    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    return () => sim.stop();
  }, [graphData, activeNote?.note?.id]);

  if (!activeWorkspace) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Select a workspace to view graph
      </div>
    );
  }

  return (
    <div style={{ flex: 1, position: 'relative', background: 'var(--bg-base)', overflow: 'hidden' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
      {/* Stats overlay */}
      <div style={{
        position: 'absolute', top: 16, right: 16, background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)'
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Graph</div>
        <div>{graphData?.nodes?.length || 0} notes · {graphData?.edges?.length || 0} connections</div>
        {hovered && <div style={{ marginTop: 6, color: 'var(--accent-hover)', fontWeight: 600 }}>📄 {hovered.title}</div>}
      </div>
      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16, background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)'
      }}>
        <div>🖱️ Drag to pan · Scroll to zoom</div>
        <div style={{ marginTop: 3 }}>Click node to open note</div>
      </div>
    </div>
  );
}
