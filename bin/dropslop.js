#!/usr/bin/env node
'use strict';
/* dropslop: check markdown and text files for phrases that read machine-made.
   No dependencies; Node 18 or later. Each file is one check through POST <api>/v1/lint (DropSlop's own endpoint).
   Without DROPSLOP_API_KEY it uses the free checks DropSlop gives anyone; with a key it uses that plan's allowance. */
const fs = require('fs');

const HELP = `Usage: dropslop check <file ...> [options]

  --threshold <n>   exit 1 if any file's human score is under n (0-100)
  --cuts            also print a suggested replacement for each flagged phrase
  --json            print the raw answers as JSON
  --api-url <url>   default https://dropslop.ai (or DROPSLOP_API_URL)
  -h, --help

Reads .md, .mdx and .txt. Front matter, code blocks and inline code are left out of the check.
Set DROPSLOP_API_KEY to use your plan's allowance. Exit codes: 0 fine, 1 under the threshold, 2 could not check.`;

/* Blank out front matter, fenced code and inline code with spaces, keeping every newline, so a position in the
   text that was checked is the same position in the file. */
function prose(src) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let out = src.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/, blank);
  out = out.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, blank);
  return out.replace(/`[^`\n]+`/g, blank);
}

function lineCol(text, pos) {
  let line = 1, last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) { line++; last = i; }
  return [line, pos - last];
}

function parse(argv) {
  const o = { files: [], threshold: null, cuts: false, json: false, api: process.env.DROPSLOP_API_URL || 'https://dropslop.ai', help: false };
  const args = argv.slice();
  if (args[0] === 'check') args.shift();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--cuts') o.cuts = true;
    else if (a === '--json') o.json = true;
    else if (a === '--threshold') o.threshold = Number(args[++i]);
    else if (a === '--api-url') o.api = String(args[++i] || '');
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
    else o.files.push(a);
  }
  if (o.threshold !== null && !(o.threshold >= 0 && o.threshold <= 100)) throw new Error('--threshold takes a number from 0 to 100');
  return o;
}

async function lint(api, text, cuts) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'dropslop-cli/0.1.0' };
  if (process.env.DROPSLOP_API_KEY) headers.Authorization = `Bearer ${process.env.DROPSLOP_API_KEY.trim()}`;
  const res = await fetch(api.replace(/\/+$/, '') + '/v1/lint', { method: 'POST', headers, body: JSON.stringify({ text, mode: cuts ? 'cuts' : 'xray' }) });
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const d = body && body.detail;
    const msg = typeof d === 'string' ? d : (d && d.message) || `DropSlop answered ${res.status}`;
    throw new Error(res.status === 402 && !process.env.DROPSLOP_API_KEY ? `${msg} Or set DROPSLOP_API_KEY (https://dropslop.ai/keys/).` : msg);
  }
  return body;
}

function report(file, text, r, o, c) {
  const under = o.threshold !== null && r.humanScore < o.threshold;
  const lines = [`${c.bold(file)}  ${under ? c.red(`${r.humanScore}% human`) : c.green(`${r.humanScore}% human`)}  ${c.dim(`${r.words} words`)}` +
    (under ? c.red(`  under ${o.threshold}`) : '')];
  for (const s of r.flaggedSpans || []) {
    const [l, col] = lineCol(text, s.start);
    let row = `  ${c.dim(`${l}:${col}`.padEnd(8))} ${c.yellow(JSON.stringify(s.text))}  ${s.reason}`;
    if (o.cuts && s.suggestedCut !== null && s.suggestedCut !== undefined) row += c.dim(s.suggestedCut === '' ? '  -> cut it' : `  -> ${JSON.stringify(s.suggestedCut)}`);
    lines.push(row);
  }
  for (const [a, b] of r.uniformCadenceBrackets || []) {
    const l1 = lineCol(text, a)[0], l2 = lineCol(text, Math.max(a, b - 1))[0];
    lines.push(`  ${c.dim((l1 === l2 ? `${l1}` : `${l1}-${l2}`).padEnd(8))} ${c.yellow('sentences of nearly the same length in a row')}`);
  }
  if (!(r.flaggedSpans || []).length && !(r.uniformCadenceBrackets || []).length) lines.push(c.dim('  nothing flagged'));
  return { text: lines.join('\n'), under };
}

async function main(argv, io) {
  io = io || { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n'), color: process.stdout.isTTY && !process.env.NO_COLOR };
  const paint = (n) => (s) => (io.color ? `\x1b[${n}m${s}\x1b[0m` : String(s));
  const c = { bold: paint(1), dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33) };
  let o;
  try { o = parse(argv); } catch (e) { io.err(e.message); io.err(HELP); return 2; }
  if (o.help || !o.files.length) { io.out(HELP); return o.help ? 0 : 2; }
  let code = 0;
  const all = [];
  for (const file of o.files) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch (e) { io.err(`${file}: cannot be read (${e.code || e.message})`); code = 2; continue; }
    const text = prose(src);
    if (!text.trim()) { io.err(`${file}: no prose to check`); continue; }
    try {
      const r = await lint(o.api, text, o.cuts);
      all.push({ file, ...r });
      if (!o.json) {
        const rep = report(file, text, r, o, c);
        io.out(rep.text);
        if (rep.under && code === 0) code = 1;
      } else if (o.threshold !== null && r.humanScore < o.threshold && code === 0) code = 1;
    } catch (e) { io.err(`${file}: ${e.message}`); code = 2; }
  }
  if (o.json) io.out(JSON.stringify(all, null, 2));
  else if (all.length) io.out(c.dim('\nSee the full check and rewrite: https://dropslop.ai/editor/'));
  return code;
}

module.exports = { prose, lineCol, parse, main };
if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
