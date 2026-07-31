function matchCount(src, anchor){
  if(typeof anchor==='string'){
    if(!anchor.length) throw new Error('harness transform: empty string anchor');
    let count=0, at=0;
    while((at=src.indexOf(anchor, at))!==-1){ count++; at+=anchor.length; }
    return count;
  }
  if(!(anchor instanceof RegExp)) throw new TypeError('harness transform: anchor must be a string or RegExp');
  const flags=anchor.flags.includes('g')?anchor.flags:anchor.flags+'g';
  return [...src.matchAll(new RegExp(anchor.source, flags))].length;
}

function replaceExactlyOnce(src, anchor, replacement, label, owner='harness'){
  const count=matchCount(src, anchor);
  if(count!==1) throw new Error(`${owner}: expected exactly one ${label} anchor, found ${count}`);
  return src.replace(anchor, replacement);
}

function extractEngineSource(html, owner='harness'){
  const scripts=[...html.matchAll(/<script>\r?\n"use strict";([\s\S]*?)<\/script>/g)];
  if(scripts.length!==1)
    throw new Error(`${owner}: expected exactly one strict engine script, found ${scripts.length}`);
  return scripts[0][1];
}

function stripEngineBootstrap(src, owner='harness'){
  const anchor=/\/\* ---------- go ---------- \*\/\s*updateSession\(\);\s*new(?:Hand|Session)\(\);/;
  const count=matchCount(src, anchor);
  if(count!==1) throw new Error(`${owner}: expected exactly one bootstrap strip anchor, found ${count}`);
  const match=anchor.exec(src);
  if(src.slice(match.index+match[0].length).trim())
    throw new Error(`${owner}: bootstrap strip anchor must terminate the engine script`);
  return src.slice(0,match.index)+src.slice(match.index+match[0].length);
}

module.exports={replaceExactlyOnce, extractEngineSource, stripEngineBootstrap};
