// The programming languages code blocks understand, shared by the editor (lowlight), the
// Markdown preview (highlight.js) and the language picker.
import { createLowlight, common } from 'lowlight';
import hljs from 'highlight.js/lib/core';
import apache from 'highlight.js/lib/languages/apache';
import applescript from 'highlight.js/lib/languages/applescript';
import armasm from 'highlight.js/lib/languages/armasm';
import autohotkey from 'highlight.js/lib/languages/autohotkey';
import awk from 'highlight.js/lib/languages/awk';
import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import coffeescript from 'highlight.js/lib/languages/coffeescript';
import crystal from 'highlight.js/lib/languages/crystal';
import dart from 'highlight.js/lib/languages/dart';
import delphi from 'highlight.js/lib/languages/delphi';
import django from 'highlight.js/lib/languages/django';
import dns from 'highlight.js/lib/languages/dns';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import elixir from 'highlight.js/lib/languages/elixir';
import elm from 'highlight.js/lib/languages/elm';
import erb from 'highlight.js/lib/languages/erb';
import erlang from 'highlight.js/lib/languages/erlang';
import excel from 'highlight.js/lib/languages/excel';
import fortran from 'highlight.js/lib/languages/fortran';
import fsharp from 'highlight.js/lib/languages/fsharp';
import gcode from 'highlight.js/lib/languages/gcode';
import gherkin from 'highlight.js/lib/languages/gherkin';
import glsl from 'highlight.js/lib/languages/glsl';
import gradle from 'highlight.js/lib/languages/gradle';
import groovy from 'highlight.js/lib/languages/groovy';
import handlebars from 'highlight.js/lib/languages/handlebars';
import haskell from 'highlight.js/lib/languages/haskell';
import http from 'highlight.js/lib/languages/http';
import julia from 'highlight.js/lib/languages/julia';
import latex from 'highlight.js/lib/languages/latex';
import ldif from 'highlight.js/lib/languages/ldif';
import lisp from 'highlight.js/lib/languages/lisp';
import matlab from 'highlight.js/lib/languages/matlab';
import mathematica from 'highlight.js/lib/languages/mathematica';
import nginx from 'highlight.js/lib/languages/nginx';
import nim from 'highlight.js/lib/languages/nim';
import nix from 'highlight.js/lib/languages/nix';
import ocaml from 'highlight.js/lib/languages/ocaml';
import pgsql from 'highlight.js/lib/languages/pgsql';
import powershell from 'highlight.js/lib/languages/powershell';
import prolog from 'highlight.js/lib/languages/prolog';
import properties from 'highlight.js/lib/languages/properties';
import protobuf from 'highlight.js/lib/languages/protobuf';
import puppet from 'highlight.js/lib/languages/puppet';
import routeros from 'highlight.js/lib/languages/routeros';
import sas from 'highlight.js/lib/languages/sas';
import scala from 'highlight.js/lib/languages/scala';
import scheme from 'highlight.js/lib/languages/scheme';
import stata from 'highlight.js/lib/languages/stata';
import tcl from 'highlight.js/lib/languages/tcl';
import twig from 'highlight.js/lib/languages/twig';
import vbscript from 'highlight.js/lib/languages/vbscript';
import verilog from 'highlight.js/lib/languages/verilog';
import vhdl from 'highlight.js/lib/languages/vhdl';
import vim from 'highlight.js/lib/languages/vim';
import x86asm from 'highlight.js/lib/languages/x86asm';

const EXTRA = {
  apache, applescript, armasm, autohotkey, awk, clojure, cmake, coffeescript, crystal, dart, delphi, django, dns,
  dockerfile, dos, elixir, elm, erb, erlang, excel, fortran, fsharp, gcode, gherkin, glsl, gradle, groovy, handlebars,
  haskell, http, julia, latex, ldif, lisp, matlab, mathematica, nginx, nim, nix, ocaml, pgsql, powershell, prolog,
  properties, protobuf, puppet, routeros, sas, scala, scheme, stata, tcl, twig, vbscript, verilog, vhdl, vim, x86asm,
};
const ALL = { ...common, ...EXTRA };

export const lowlight = createLowlight(ALL);
for (const [name, def] of Object.entries(ALL)) hljs.registerLanguage(name, def);

// What the picker shows. `id` is the name saved with the block (and in ```fences);
// `aliases` are extra words for the picker's search (typing ```ps1 etc. also works).
export const LANGUAGES = [
  // Popular
  { id: 'plaintext', label: 'Plain text', aliases: 'text txt none' },
  { id: 'bash', label: 'Bash / Shell', aliases: 'sh shell zsh linux terminal' },
  { id: 'powershell', label: 'PowerShell', aliases: 'ps ps1 pwsh windows' },
  { id: 'dos', label: 'Batch / CMD', aliases: 'bat cmd windows command prompt' },
  { id: 'python', label: 'Python', aliases: 'py' },
  { id: 'javascript', label: 'JavaScript', aliases: 'js node jsx' },
  { id: 'typescript', label: 'TypeScript', aliases: 'ts tsx' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML', aliases: 'yml compose ansible kubernetes k8s' },
  { id: 'xml', label: 'HTML / XML', aliases: 'html xhtml svg' },
  { id: 'css', label: 'CSS' },
  { id: 'sql', label: 'SQL', aliases: 'mysql sqlite mssql tsql database' },
  { id: 'markdown', label: 'Markdown', aliases: 'md' },
  // Languages
  { id: 'c', label: 'C', aliases: 'h' },
  { id: 'cpp', label: 'C++', aliases: 'cc hpp' },
  { id: 'csharp', label: 'C#', aliases: 'cs dotnet' },
  { id: 'java', label: 'Java' },
  { id: 'go', label: 'Go', aliases: 'golang' },
  { id: 'rust', label: 'Rust', aliases: 'rs' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby', aliases: 'rb' },
  { id: 'kotlin', label: 'Kotlin', aliases: 'kt' },
  { id: 'swift', label: 'Swift' },
  { id: 'objectivec', label: 'Objective-C', aliases: 'objc' },
  { id: 'dart', label: 'Dart', aliases: 'flutter' },
  { id: 'scala', label: 'Scala' },
  { id: 'vbnet', label: 'VB.NET', aliases: 'visual basic vb' },
  { id: 'vbscript', label: 'VBScript', aliases: 'vbs' },
  { id: 'lua', label: 'Lua' },
  { id: 'perl', label: 'Perl', aliases: 'pl' },
  { id: 'r', label: 'R' },
  { id: 'julia', label: 'Julia' },
  { id: 'matlab', label: 'MATLAB' },
  { id: 'haskell', label: 'Haskell', aliases: 'hs' },
  { id: 'elixir', label: 'Elixir', aliases: 'ex' },
  { id: 'erlang', label: 'Erlang' },
  { id: 'clojure', label: 'Clojure', aliases: 'clj' },
  { id: 'fsharp', label: 'F#', aliases: 'fs' },
  { id: 'ocaml', label: 'OCaml', aliases: 'ml' },
  { id: 'groovy', label: 'Groovy' },
  { id: 'crystal', label: 'Crystal' },
  { id: 'nim', label: 'Nim' },
  { id: 'elm', label: 'Elm' },
  { id: 'coffeescript', label: 'CoffeeScript', aliases: 'coffee' },
  { id: 'delphi', label: 'Delphi / Pascal', aliases: 'pascal' },
  { id: 'fortran', label: 'Fortran' },
  { id: 'lisp', label: 'Lisp' },
  { id: 'scheme', label: 'Scheme' },
  { id: 'prolog', label: 'Prolog' },
  { id: 'tcl', label: 'Tcl' },
  { id: 'awk', label: 'AWK' },
  { id: 'applescript', label: 'AppleScript' },
  { id: 'autohotkey', label: 'AutoHotkey', aliases: 'ahk' },
  { id: 'x86asm', label: 'Assembly (x86)', aliases: 'asm nasm' },
  { id: 'armasm', label: 'Assembly (ARM)', aliases: 'asm arm' },
  { id: 'verilog', label: 'Verilog' },
  { id: 'vhdl', label: 'VHDL' },
  { id: 'glsl', label: 'GLSL', aliases: 'shader' },
  { id: 'sas', label: 'SAS' },
  { id: 'stata', label: 'Stata' },
  { id: 'mathematica', label: 'Mathematica', aliases: 'wolfram' },
  { id: 'latex', label: 'LaTeX', aliases: 'tex' },
  { id: 'excel', label: 'Excel formula', aliases: 'xlsx spreadsheet' },
  // Web & templates
  { id: 'scss', label: 'SCSS / Sass' },
  { id: 'less', label: 'Less' },
  { id: 'graphql', label: 'GraphQL', aliases: 'gql' },
  { id: 'handlebars', label: 'Handlebars', aliases: 'hbs mustache' },
  { id: 'django', label: 'Django / Jinja', aliases: 'jinja' },
  { id: 'twig', label: 'Twig' },
  { id: 'erb', label: 'ERB' },
  { id: 'wasm', label: 'WebAssembly' },
  // Config, servers & ops
  { id: 'dockerfile', label: 'Dockerfile', aliases: 'docker' },
  { id: 'nginx', label: 'Nginx config' },
  { id: 'apache', label: 'Apache config', aliases: 'htaccess' },
  { id: 'ini', label: 'INI / TOML', aliases: 'toml conf cfg' },
  { id: 'properties', label: 'Properties / .env', aliases: 'env dotenv' },
  { id: 'makefile', label: 'Makefile', aliases: 'make' },
  { id: 'cmake', label: 'CMake' },
  { id: 'gradle', label: 'Gradle' },
  { id: 'nix', label: 'Nix' },
  { id: 'puppet', label: 'Puppet' },
  { id: 'routeros', label: 'MikroTik RouterOS', aliases: 'mikrotik' },
  { id: 'dns', label: 'DNS zone file', aliases: 'bind zone' },
  { id: 'ldif', label: 'LDIF', aliases: 'ldap active directory' },
  { id: 'http', label: 'HTTP request', aliases: 'rest api' },
  { id: 'pgsql', label: 'PostgreSQL (PL/pgSQL)', aliases: 'postgres' },
  { id: 'protobuf', label: 'Protocol Buffers', aliases: 'proto' },
  { id: 'diff', label: 'Diff / Patch', aliases: 'patch git' },
  { id: 'vim', label: 'Vim script' },
  { id: 'gherkin', label: 'Gherkin / Cucumber', aliases: 'feature' },
  { id: 'gcode', label: 'G-code', aliases: 'cnc 3d printer' },
  { id: 'python-repl', label: 'Python console', aliases: 'pycon' },
  { id: 'shell', label: 'Shell session', aliases: 'console terminal output' },
];

const BY_ID = new Map(LANGUAGES.map(l => [l.id, l]));

/** The picker entry for a saved language name or alias ("ps1" → PowerShell); null if unknown. */
export function findLanguage(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  if (BY_ID.has(n)) return BY_ID.get(n);
  const def = hljs.getLanguage(n);
  if (def) {
    for (const l of LANGUAGES) if (hljs.getLanguage(l.id) === def) return l;
  }
  return null;
}

export function filterLanguages(query) {
  const q = query.toLowerCase().trim();
  if (!q) return LANGUAGES;
  const hits = LANGUAGES.filter(l => `${l.label} ${l.id} ${l.aliases || ''}`.toLowerCase().includes(q));
  // Labels that start with the query first
  return hits.sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1));
}

// Auto-detect only among everyday languages: guessing across ~95 is slow and often wrong.
export const AUTO_DETECT = [
  'bash', 'powershell', 'dos', 'python', 'javascript', 'typescript', 'json', 'yaml', 'xml', 'css', 'sql', 'c', 'cpp',
  'csharp', 'java', 'go', 'rust', 'php', 'ruby', 'dockerfile', 'nginx', 'ini', 'markdown', 'diff',
];

export function detectLanguage(code) {
  if (!code.trim()) return null;
  return lowlight.highlightAuto(code, { subset: AUTO_DETECT }).data?.language || null;
}

/** The lowlight object handed to the editor: like `lowlight`, but auto-detect uses AUTO_DETECT. */
export const editorLowlight = {
  highlight: (...a) => lowlight.highlight(...a),
  highlightAuto: (code) => lowlight.highlightAuto(code, { subset: AUTO_DETECT }),
  listLanguages: () => lowlight.listLanguages(),
  registered: (n) => lowlight.registered(n),
  register: (...a) => lowlight.register(...a),
  registerAlias: (...a) => lowlight.registerAlias(...a),
};

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Highlighted HTML for the Markdown preview. */
export function highlightToHtml(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    if (!lang) return hljs.highlightAuto(code, AUTO_DETECT).value;
  } catch { /* fall through */ }
  return escapeHtml(code);
}

export function languageLabel(name) {
  return findLanguage(name)?.label || name;
}
