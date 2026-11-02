// A recorded meeting inside a note: recording / uploading / transcribing status, then the audio
// player, speakers (click to rename) and the transcript (click a time to jump there).
// When the transcript is ready, the AI summary + to-do list (if any) are added below the block as
// normal note text, so they show up in Tasks, search and exports.
//
// Stored as <div data-meeting="<id>" data-local-id data-title data-status data-duration
//   data-segments='[{start,end,speaker,text}]' data-speakers='{"0":"Name"}' data-summary-inserted>
// Markdown: ```synapse-meeting fence (convert.js).
import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Mic, Loader2, AlertTriangle, RotateCcw, Trash2, Copy, MoreHorizontal, Upload, Square, Pause, Play, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRecorder, getMeeting, audioLink, renameSpeakers, retryMeeting, deleteMeetingAudio, retryUnsent, errorText, clock } from '../../meetings/client';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16'];
export const speakerColor = i => (i === null || i === undefined ? 'var(--text-muted)' : COLORS[i % COLORS.length]);
export const speakerName = (speakers, i) => (i === null || i === undefined ? 'Someone' : speakers?.[i] || `Speaker ${i + 1}`);

const jsonAttr = (name, fallback) => ({
  default: fallback,
  parseHTML: el => { try { return JSON.parse(el.getAttribute(name) || ''); } catch { return fallback; } },
  renderHTML: attrs => ({}), // written in renderHTML below
});

/** Plain-text transcript (copy, Markdown, exports). */
export function transcriptText(segments, speakers) {
  return (segments || []).map(s => `[${clock(s.start)}] ${speakerName(speakers, s.speaker)}: ${s.text}`).join('\n');
}

function MeetingView({ node, updateAttributes, editor, getPos, deleteNode }) {
  const a = node.attrs;
  const rec = useRecorder(s => (a.localId && s.localId === a.localId ? s : null));
  const [m, setM] = useState(null);       // server meeting while processing
  const [audio, setAudio] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(-1);
  const [, tick] = useState(0);
  const player = useRef(null);
  const editable = editor.isEditable;

  // Recording on this device finished uploading → remember the meeting id.
  useEffect(() => {
    const on = e => { if (e.detail.localId === a.localId && !a.meetingId) updateAttributes({ meetingId: e.detail.meeting.id, status: 'processing' }); };
    window.addEventListener('synapse:meeting-uploaded', on);
    return () => window.removeEventListener('synapse:meeting-uploaded', on);
  }, [a.localId, a.meetingId]);

  // Recording thrown away → remove the block.
  useEffect(() => {
    const on = e => { if (e.detail.localId && e.detail.localId === a.localId && !a.meetingId) deleteNode(); };
    window.addEventListener('synapse:meeting-discarded', on);
    return () => window.removeEventListener('synapse:meeting-discarded', on);
  }, [a.localId, a.meetingId]);

  // Recording timer.
  useEffect(() => {
    if (!rec || (rec.state !== 'recording')) return undefined;
    const t = setInterval(() => tick(x => x + 1), 500);
    return () => clearInterval(t);
  }, [rec?.state]);

  // While transcribing: follow progress (live events + a slow poll as a fallback).
  useEffect(() => {
    if (!a.meetingId || a.status === 'done') return undefined;
    let stop = false;
    const load = async () => {
      try {
        const mm = await getMeeting(a.meetingId);
        if (stop) return;
        setM(mm);
        if (mm.status === 'done') finish(mm);
      } catch { /* offline: try again */ }
    };
    load();
    const t = setInterval(load, 5000);
    const on = e => { if (e.detail.id === a.meetingId) { setM(x => ({ ...(x || {}), ...e.detail })); if (e.detail.status === 'done') load(); } };
    window.addEventListener('synapse:meeting-update', on);
    return () => { stop = true; clearInterval(t); window.removeEventListener('synapse:meeting-update', on); };
  }, [a.meetingId, a.status]);

  const finish = mm => {
    if (!editable) return;
    updateAttributes({ status: 'done', segments: mm.transcript || [], speakers: mm.speaker_names || {}, duration: mm.duration || 0, summaryInserted: a.summaryInserted || !(mm.summary || mm.actions?.length) });
    if (!a.summaryInserted && (mm.summary || mm.actions?.length)) {
      import('../editor/convert').then(({ markdownToHtml }) => {
        const parts = [];
        if (mm.summary) parts.push(`### Summary\n\n${mm.summary}`);
        if (mm.actions?.length) parts.push(`### Action items\n\n${mm.actions.map(x => `- [ ] ${x.task}${x.who ? ` (${x.who})` : ''}${x.due ? ` 📅 ${x.due}` : ''}`).join('\n')}`);
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        const at = pos + editor.state.doc.nodeAt(pos).nodeSize;
        editor.chain().insertContentAt(at, markdownToHtml(parts.join('\n\n'))).run();
        updateAttributes({ summaryInserted: true });
      });
    }
  };

  // The player (signed link, refreshed when it runs out).
  useEffect(() => {
    if (a.status !== 'done' || !a.meetingId) return;
    audioLink(a.meetingId).then(setAudio).catch(() => setAudio(null));
  }, [a.status, a.meetingId]);

  const seek = t => { const p = player.current; if (!p) return; p.currentTime = Math.max(0, t - 0.3); p.play().catch(() => {}); };
  const rename = async i => {
    if (!editable) return;
    const name = prompt(`Name for ${speakerName(a.speakers, i)}:`, a.speakers?.[i] || '');
    if (name === null) return;
    const speakers = { ...(a.speakers || {}) };
    if (name.trim()) speakers[i] = name.trim(); else delete speakers[i];
    updateAttributes({ speakers });
    if (a.meetingId) renameSpeakers(a.meetingId, { [i]: name.trim() }).catch(() => {});
  };
  const again = async () => {
    setMenu(false);
    const n = prompt('Transcribe again. How many people spoke? (leave empty to let Synapse work it out)', '');
    if (n === null) return;
    try { await retryMeeting(a.meetingId, { speakers: parseInt(n, 10) || 0 }); updateAttributes({ status: 'processing', summaryInserted: true }); toast.success('Transcribing again'); } catch (err) { toast.error(errorText(err)); }
  };
  const dropAudio = async () => {
    setMenu(false);
    if (!confirm('Delete the audio recording? The transcript stays in the note.')) return;
    try { await deleteMeetingAudio(a.meetingId); setAudio(null); toast.success('Recording deleted'); } catch (err) { toast.error(errorText(err)); }
  };
  const copy = async () => {
    setMenu(false);
    try { await navigator.clipboard.writeText(transcriptText(a.segments, a.speakers)); toast.success('Transcript copied'); } catch { toast.error('Couldn’t copy'); }
  };

  // Group consecutive lines from the same speaker into turns.
  const turns = [];
  for (const s of a.segments || []) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < 4) { last.end = s.end; last.parts.push(s); } else turns.push({ speaker: s.speaker, start: s.start, end: s.end, parts: [s] });
  }
  const shown = expanded ? turns : turns.slice(0, 6);
  const speakerIds = [...new Set((a.segments || []).map(s => s.speaker).filter(x => x !== null && x !== undefined))];

  let body;
  if (!a.meetingId) {
    if (rec && (rec.state === 'recording' || rec.state === 'paused')) {
      body = (
        <div className="mtg-status">
          <span className={`mtg-dot${rec.state === 'recording' ? ' live' : ''}`} />
          <b>{rec.state === 'recording' ? 'Recording' : 'Paused'}</b> · {clock(useRecorder.getState().elapsed())}
          <span style={{ flex: 1 }} />
          {rec.state === 'recording'
            ? <button type="button" className="btn-ghost" onClick={() => useRecorder.getState().pause()}><Pause size={14} /> Pause</button>
            : <button type="button" className="btn-ghost" onClick={() => useRecorder.getState().resume()}><Play size={14} /> Resume</button>}
          <button type="button" className="mtg-stop" onClick={() => window.dispatchEvent(new CustomEvent('synapse:recorder-stop'))}><Square size={12} /> Stop</button>
        </div>
      );
    } else if (rec && (rec.state === 'stopping' || rec.state === 'stopped' || rec.state === 'uploading')) {
      body = <div className="mtg-status"><Loader2 size={15} className="spin" /> {rec.state === 'uploading' ? `Uploading the recording… ${rec.progress || 0}%` : 'Finishing the recording…'}</div>;
    } else {
      body = (
        <div className="mtg-status">
          <Upload size={15} /> Waiting to upload (the recording is saved on the device it was made on).
          <span style={{ flex: 1 }} />
          {editable && <button type="button" className="btn-ghost" onClick={() => retryUnsent()}>Upload now</button>}
          {editable && <button type="button" className="btn-ghost danger-hover" title="Remove" onClick={() => deleteNode()}><Trash2 size={13} /></button>}
        </div>
      );
    }
  } else if (a.status !== 'done') {
    const failed = m?.status === 'failed';
    body = failed ? (
      <div className="mtg-status error">
        <AlertTriangle size={15} /> <span>{m.error || 'Transcription failed'}</span>
        <span style={{ flex: 1 }} />
        {editable && <button type="button" className="btn-ghost" onClick={again}><RotateCcw size={13} /> Try again</button>}
      </div>
    ) : (
      <div className="mtg-progress">
        <div className="mtg-status"><Loader2 size={15} className="spin" /> {m?.status === 'queued' ? (m.queue_position > 1 ? `Waiting — ${m.queue_position - 1} recording${m.queue_position > 2 ? 's' : ''} ahead` : 'Starting…') : m?.stage || 'Transcribing…'} <span style={{ flex: 1 }} /> {m ? `${Math.round((m.progress || 0) * 100)}%` : ''}</div>
        <div className="mtg-bar"><span style={{ width: `${Math.round((m?.progress || 0) * 100)}%` }} /></div>
        <p className="mtg-hint">You can keep working — the transcript appears here when it’s ready{m?.duration ? ` (${clock(m.duration)} of audio)` : ''}.</p>
      </div>
    );
  } else {
    body = (
      <>
        {audio ? <audio ref={player} className="mtg-audio" src={audio} controls preload="metadata" onTimeUpdate={e => setNow(e.currentTarget.currentTime)} onError={() => a.meetingId && audioLink(a.meetingId).then(setAudio).catch(() => {})} />
          : <p className="mtg-hint">{a.meetingId ? 'The audio was deleted — the transcript is kept.' : ''}</p>}
        {speakerIds.length > 0 && (
          <div className="mtg-speakers">
            {speakerIds.map(i => (
              <button key={i} type="button" className="mtg-speaker" onClick={() => rename(i)} title={editable ? 'Click to rename' : ''}>
                <span style={{ background: speakerColor(i) }} /> {speakerName(a.speakers, i)}
              </button>
            ))}
            {editable && <span className="mtg-hint" style={{ margin: 0 }}>Click a name to rename it</span>}
          </div>
        )}
        <div className="mtg-transcript">
          {!turns.length && <p className="mtg-hint">No speech was found in the recording.</p>}
          {shown.map((t, i) => {
            const active = now >= t.start && now <= t.end + 0.5;
            return (
              <div key={i} className={`mtg-turn${active ? ' on' : ''}`}>
                <div className="mtg-who">
                  <b style={{ color: speakerColor(t.speaker) }}>{speakerName(a.speakers, t.speaker)}</b>
                  <button type="button" className="mtg-time" onClick={() => seek(t.start)} title="Play from here">{clock(t.start)}</button>
                </div>
                <p>{t.parts.map(p => p.text).join(' ')}</p>
              </div>
            );
          })}
        </div>
        {turns.length > 6 && (
          <button type="button" className="btn-ghost mtg-more" onClick={() => setExpanded(x => !x)}>
            {expanded ? <><ChevronUp size={14} /> Show less</> : <><ChevronDown size={14} /> Show the whole transcript ({turns.length} parts)</>}
          </button>
        )}
      </>
    );
  }

  return (
    <NodeViewWrapper className="mtg" contentEditable={false} data-drag-handle="">
      <div className="mtg-head">
        <Mic size={16} className="mtg-icon" />
        <span className="mtg-title">{a.title || 'Meeting'}</span>
        <span className="mtg-meta">{a.duration ? clock(a.duration) : ''}{a.createdAt ? ` · ${new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
        <span style={{ flex: 1 }} />
        {a.status === 'done' && (
          <span style={{ position: 'relative' }}>
            <button type="button" className="btn-ghost" onClick={() => setMenu(x => !x)} title="More"><MoreHorizontal size={15} /></button>
            {menu && (
              <div className="mtg-menu" onMouseLeave={() => setMenu(false)}>
                <button type="button" onClick={copy}><Copy size={13} /> Copy transcript</button>
                {editable && a.meetingId && <button type="button" onClick={again}><RotateCcw size={13} /> Transcribe again…</button>}
                {editable && a.meetingId && audio && <button type="button" onClick={dropAudio}><Trash2 size={13} /> Delete the audio</button>}
                {editable && <button type="button" className="danger" onClick={() => { setMenu(false); if (confirm('Remove this meeting from the note?')) deleteNode(); }}><Trash2 size={13} /> Remove from note</button>}
              </div>
            )}
          </span>
        )}
      </div>
      {body}
    </NodeViewWrapper>
  );
}

export const MeetingNode = Node.create({
  name: 'meeting',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      meetingId: { default: null, parseHTML: el => el.getAttribute('data-meeting') || null },
      localId: { default: null, parseHTML: el => el.getAttribute('data-local-id') || null },
      title: { default: 'Meeting', parseHTML: el => el.getAttribute('data-title') || 'Meeting' },
      status: { default: 'recording', parseHTML: el => el.getAttribute('data-status') || 'processing' },
      duration: { default: 0, parseHTML: el => Number(el.getAttribute('data-duration')) || 0 },
      createdAt: { default: null, parseHTML: el => Number(el.getAttribute('data-created')) || null },
      summaryInserted: { default: false, parseHTML: el => el.getAttribute('data-summary-inserted') === 'true' },
      segments: jsonAttr('data-segments', []),
      speakers: jsonAttr('data-speakers', {}),
    };
  },
  parseHTML() { return [{ tag: 'div[data-meeting]' }, { tag: 'div[data-local-id]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs;
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-meeting': a.meetingId || '', 'data-local-id': a.localId || '', 'data-title': a.title || 'Meeting', 'data-status': a.status,
      'data-duration': a.duration || 0, 'data-created': a.createdAt || '', 'data-summary-inserted': a.summaryInserted ? 'true' : 'false',
      'data-segments': JSON.stringify(a.segments || []), 'data-speakers': JSON.stringify(a.speakers || {}), class: 'meeting-block',
    }), transcriptText(a.segments, a.speakers) || `🎙 ${a.title || 'Meeting'}`];
  },
  renderText: ({ node }) => `🎙 ${node.attrs.title}\n${transcriptText(node.attrs.segments, node.attrs.speakers)}`,
  addNodeView() { return ReactNodeViewRenderer(MeetingView); },
});
