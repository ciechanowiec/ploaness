// The stylesheet, typefaces and script the compliance report inlines, kept apart from the markup that uses them.

/** One embedded typeface file. */
export interface EmbeddedFont {
  readonly family: string
  readonly style: 'normal' | 'italic'
  /** The weight range a variable font covers, such as `200 900`. */
  readonly weight: string
  /** The WOFF2 file, base64-encoded. */
  readonly data: string
}

/**
 * The `@font-face` rules for the embedded typefaces, so the document reads the same with no font installed.
 * @param fonts the typefaces.
 * @returns the CSS rules.
 */
export const fontFaces = (fonts: readonly EmbeddedFont[]): string =>
  fonts
    .map(
      (font: EmbeddedFont): string =>
        `@font-face{font-family:"${font.family}";font-style:${font.style};font-weight:${font.weight};` +
        `font-display:block;src:url(data:font/woff2;base64,${font.data}) format("woff2")}`,
    )
    .join('')

/** The report's stylesheet: the screen layout with its contents panel, then the A4 print layout. */
export const REPORT_STYLE: string = String.raw`
:root{color-scheme:light;--ink:#1b1f26;--ink-strong:#0a0d12;--muted:#4d5560;--accent:#1b3a6b;--accent-deep:#16315c;
--rule:#d5dae1;--hair:#e2e6ec;--grid:#c3cfe0;--panel:#f6f8fa;--stripe:#f9fafc;--code-bg:#f3f6fb;--code-edge:#b4c1d4;
--good:#166a2f;--good-bg:#edf4ef;--bad:#ae2a20;--bad-bg:#f9eeec;--warn:#8a5a00;--warn-bg:#fbf5e6;
--permissive:#1b3a6b;--weak:#b7791f;--refused:#ae2a20;--other:#9aa6b8;
--serif:"Source Serif 4",Charter,Georgia,"Times New Roman",serif;
--display:"Playfair Display","Iowan Old Style",Georgia,serif;
--mono:"Source Code Pro",SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:#fff;font-size:16px}
body{margin:0;padding:0 0 0 22rem;background:#fff;color:var(--ink);font-family:var(--serif);font-size:17px;
line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal;
font-feature-settings:"lnum" 1}
table,code,.mono,#toc,.count,.adnum,.figure b{font-feature-settings:"lnum" 1,"tnum" 1}
#header,#content,#footer{max-width:58.5em;margin-left:auto;margin-right:auto;padding-left:1.6em;padding-right:1.6em}
#header{padding-top:48px}
#header>h1{margin:0;padding:1.1rem 0 0;border-top:6px solid var(--accent);font-family:var(--display);font-size:3em;
font-weight:600;line-height:1.12;letter-spacing:-.015em;color:var(--ink-strong);hyphens:none;text-align:left}
#header::after{content:"";display:block;margin-top:.69rem;border-top:1px solid var(--rule)}
#content{margin-top:1.25em;margin-bottom:1.25em}
p{margin:0 0 .9em;text-align:justify;text-justify:inter-word;hyphens:auto;letter-spacing:-.01em}
table p,#toc p{text-align:left;hyphens:manual;letter-spacing:normal}
a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(27,58,107,.5);
transition:color .12s ease,border-color .12s ease,background-color .12s ease}
a:hover{color:var(--ink-strong);border-bottom-color:var(--ink-strong);background:rgba(27,58,107,.08)}
code{margin:0 .09em;padding:.06em .36em;font-family:var(--mono);font-size:.86em;color:var(--accent);
background:var(--code-bg);border:1px solid var(--code-edge);white-space:nowrap}
td code,.ids code{white-space:normal;overflow-wrap:anywhere}
.nowrap code,code.nowrap{white-space:nowrap;overflow-wrap:normal}
.mono{font-family:var(--mono);font-size:.86em}
h2,h3,#toctitle{font-family:var(--display);color:var(--accent);font-weight:600;line-height:1.22;hyphens:none;
text-align:left;font-style:normal}
h2{display:flex;gap:.3em;margin:40px 0 .8rem;padding-top:.8rem;border-top:3px solid var(--accent);font-size:1.9em;
letter-spacing:-.005em}
h3{display:flex;gap:.3em;margin:27px 0 .55rem;padding-bottom:.35em;border-bottom:1px solid var(--hair);
font-size:1.36em}
h2 .adnum,h3 .adnum{flex:0 0 auto;letter-spacing:.02em}
h3 .adnum{font-weight:700;font-size:.86em;align-self:center}
.olist>ol{margin:0 0 1em 1.75em;padding:0;list-style-type:upper-alpha}
.olist li::marker{color:var(--accent)}
.olist li>p{margin:0 0 .9em}
.admonitionblock{margin:0 0 1.25em}
.admonitionblock>table{width:100%;border:0;border-collapse:separate;background:none}
.admonitionblock td.icon{width:3.25em;padding:.5625em .7em .5625em .625em;text-align:center;vertical-align:middle}
.admonitionblock td.icon svg{display:inline-block;width:1.6em;height:1.6em;vertical-align:middle}
.admonitionblock td.content{padding:.5625em 1.25em .5625em 1em;border-left:2px solid var(--rule);
vertical-align:middle;
text-align:justify;hyphens:auto;letter-spacing:-.01em}
.admonitionblock td.content p{margin:0;letter-spacing:-.01em}
.admonitionblock td.content ul{margin:.3em 0 0;padding-left:1.2em}
.admonitionblock .title{font-family:var(--display);font-weight:600;color:var(--accent-deep)}
.icon-warning{color:var(--bad)}
.icon-ok{color:var(--good)}
.icon-fail{color:var(--bad)}
.table-wrap{overflow-x:auto;margin:0 0 1.5em}
table.tableblock{width:100%;border-collapse:collapse;border-spacing:0;background:transparent;margin:0;font-size:1em;
line-height:1.3;border-left:1px solid var(--rule);border-right:1px solid var(--rule);
border-bottom:2px solid var(--accent)}
table.tableblock th,table.tableblock td{padding:.55em .75em;border:solid var(--rule);border-width:0 1px;
vertical-align:middle;text-align:left;overflow-wrap:break-word}
table.tableblock th{font-family:var(--display);font-weight:700;color:var(--accent);border-color:var(--grid);
border-top:2px solid var(--accent);border-bottom:1px solid var(--accent);white-space:nowrap}
table.tableblock tbody tr:first-child td{border-top:2px solid var(--accent)}
table.tableblock thead+tbody tr:first-child td{border-top:0}
table.tableblock tbody tr+tr td{border-top:1px solid var(--hair)}
table.tableblock tbody tr:nth-child(even){background:var(--stripe)}
table.tableblock.facts td{vertical-align:middle}
table.tableblock.facts tbody tr:nth-child(even){background:none}
table.tableblock.facts td:first-child{width:50%;text-align:right}
table.tableblock.compact{font-size:.88em}
th[data-sort]{cursor:pointer;user-select:none}
th[aria-sort=ascending]::after{content:" \25B4"}
th[aria-sort=descending]::after{content:" \25BE"}
.nowrap{white-space:nowrap}
.empty{color:var(--muted);font-style:italic;text-align:left}
.figures{display:grid;grid-template-columns:repeat(3,1fr);margin:0 0 1.5em;border:1px solid var(--rule);
border-top:2px solid var(--accent);border-bottom:2px solid var(--accent)}
.figure{padding:.7em .9em .8em;border-right:1px solid var(--rule)}
.figure:nth-child(3n){border-right:0}
.figure:nth-child(n+4){border-top:1px solid var(--hair)}
.figure b{display:block;font-family:var(--serif);font-size:1.9em;font-weight:600;line-height:1.1;color:var(--accent)}
.figure span{display:block;margin-top:.3em;font-size:.85em;line-height:1.3;color:var(--muted);text-align:left}
.figure.good b{color:var(--good)}
.figure.warn b{color:var(--warn)}
.figure.bad b{color:var(--bad)}
.stack{display:flex;height:12px;background:var(--hair);margin:.5em 0 .6em}
.stack i{display:block;height:100%}
.seg-permissive,.fill-permissive{background:var(--permissive)}
.seg-weak-copyleft,.fill-weak-copyleft{background:var(--weak)}
.seg-refused,.fill-refused{background:var(--refused)}
.fill-other{background:var(--other)}
.legend{display:flex;flex-wrap:wrap;gap:.2em 1.6em;margin:0 0 1em;padding:0;list-style:none;font-size:.9em;
color:var(--muted)}
.legend li::before{content:"";display:inline-block;width:.75em;height:.75em;margin-right:.45em;vertical-align:-.05em}
.key-permissive::before{background:var(--permissive)}
.key-weak-copyleft::before{background:var(--weak)}
.key-refused::before{background:var(--refused)}
.bars{display:grid;grid-template-columns:minmax(9em,max-content) 1fr max-content;gap:.35em 1em;align-items:center;
margin:.4em 0 1em;font-size:.94em}
.bars .label{overflow-wrap:anywhere}
.bars .track{display:block;height:8px;background:var(--hair)}
.bars .fill{display:block;height:100%}
.bars .count{color:var(--muted);text-align:right}
.severities{display:flex;flex-wrap:wrap;gap:.4em 1.4em;margin:.3em 0 1em;padding:0;list-style:none}
.sev,.chip{display:inline-block;padding:0 .45em;border:1px solid;font-family:var(--serif);font-size:.82em;
font-weight:600;letter-spacing:.02em;line-height:1.5;white-space:nowrap}
.sev{text-transform:capitalize;color:#3c434e;border-color:#c3cbd6;background:#f3f5f8}
.sev-critical{color:#fff;background:#7a1c15;border-color:#7a1c15}
.sev-high{color:var(--bad);background:var(--bad-bg);border-color:#e3b7b2}
.sev-moderate{color:var(--warn);background:var(--warn-bg);border-color:#e6cf9a}
.sev-low{color:var(--accent);background:var(--code-bg);border-color:var(--code-edge)}
.chip-permissive{color:var(--accent);background:var(--code-bg);border-color:var(--code-edge)}
.chip-weak-copyleft{color:var(--warn);background:var(--warn-bg);border-color:#e6cf9a}
.chip-refused{color:var(--bad);background:var(--bad-bg);border-color:#e3b7b2}
.statements{margin:.3em 0 1em;padding:0;list-style:none}
.statements li{position:relative;padding:.1em 0 .55em 1.75em;text-align:justify;hyphens:auto;letter-spacing:-.01em}
.statements li::before{position:absolute;left:.1em;top:.1em;font-weight:700}
.statements li.pass::before{content:"\2713";color:var(--good)}
.statements li.fail::before{content:"\2717";color:var(--bad)}
.statements li.info::before{content:"\2139";color:var(--accent)}
.ids{display:flex;flex-wrap:wrap;gap:.45em;margin:.2em 0 1.2em;padding:0;list-style:none}
.ids li{max-width:100%}
.downloads{display:flex;flex-wrap:wrap;gap:.6em;margin:0 0 .9em}
button{font-family:var(--serif);font-size:.9em;font-weight:600;padding:.35em 1em;border:1px solid var(--accent);
background:var(--accent);color:#fff;cursor:pointer}
button+button{background:#fff;color:var(--accent)}
.controls{display:flex;flex-wrap:wrap;gap:.6em;align-items:center;margin:0 0 .9em}
.controls input,.controls select{font:inherit;font-size:.9em;padding:.35em .6em;border:1px solid #b9c2cf;
background:#fff;color:var(--ink)}
.controls input{flex:1 1 15em}
.controls output{color:var(--muted);font-size:.85em}
.notice{margin:0 0 1.4em}
.notice>.title{margin:0;font-family:var(--display);font-weight:600;font-size:1.02em;color:var(--accent);text-align:left;
overflow-wrap:anywhere}
.notice-packages{margin:.1em 0 .5em;font-size:.82em;font-style:italic;color:var(--muted);text-align:left;
overflow-wrap:anywhere}
.license-text{padding:.7em 1em .2em;background:var(--panel);border-left:2px solid var(--rule);font-size:.84em;
line-height:1.5;overflow-wrap:anywhere}
.license-text p{margin:0 0 .65em}
.license-text p.ragged{text-align:left;hyphens:manual}
.digest{font-family:var(--mono);font-size:.84em;color:var(--accent);word-break:break-all}
.license-text hr{margin:1.1em 0;border:0;border-top:1px solid var(--rule)}
.license-entry p{margin:0;text-align:left;hyphens:manual}
.license-entry p+p{margin-top:.1em}
.license-entry{margin:0 0 .65em}
.license-heading{font-family:var(--display);font-weight:700;font-size:1.08em;color:var(--accent)}
#toc{position:fixed;top:0;left:0;bottom:0;z-index:1000;width:22rem;overflow-y:auto;padding:16.4px 1.35em 3em 1.5em;
background:var(--panel);border-right:1px solid var(--hair);scrollbar-width:thin;text-align:left}
#toctitle{margin:0 0 1.2em;padding-bottom:.7em;border-bottom:1px solid var(--hair);font-size:1em;
font-variant:all-small-caps;letter-spacing:.12em;color:var(--accent-deep)}
#toc ul{margin:0 0 .5em .125em;padding:0;list-style:none;font-size:.87rem;line-height:1.6}
#toc ul ul{margin:0 0 0 .2em;padding-left:.8em;border-left:1px solid #c6cedb}
#toc li{margin-top:.14em}
#toc .sectlevel1>li{margin-top:.75em}
#toc .sectlevel1>li:first-child{margin-top:0}
#toc a{display:flex;gap:.25em;padding:.06em 0;border:0;color:#3c434e;line-height:1.32}
#toc a:hover{color:var(--accent-deep);background:none}
#toc .sectlevel1>li>a{color:var(--accent-deep);font-weight:600}
#toc .leader,#toc .page{display:none}
#footer{margin-top:3em;padding-top:1.5em;padding-bottom:3em;border-top:1px solid var(--hair);color:var(--muted);
font-size:.85em}
@media (max-width:1100px){body{padding-left:0}#toc{position:static;width:auto;border-right:0;
border-bottom:1px solid var(--hair);padding:1.2rem 1.4rem;margin:1.2em 0}}
@media (max-width:640px){body{font-size:16px}#header>h1{font-size:2.2em}h2{font-size:1.55em}h3{font-size:1.2em}
.figures{grid-template-columns:repeat(2,1fr)}.figure:nth-child(n){border-right:1px solid var(--rule);border-top:0}
.figure:nth-child(2n){border-right:0}.figure:nth-child(n+3){border-top:1px solid var(--hair)}
.bars{grid-template-columns:1fr max-content}.bars .track{grid-column:1 / -1}.olist>ol{margin-left:1.4em}}
@page{size:A4;margin:16mm 16mm 18mm;
@bottom-center{content:counter(page);font:8.5pt "Source Serif 4",Georgia,serif;color:#1b1f26;
border-top:1px solid #e2e6ec;vertical-align:middle}}
@media print{html{font-size:12px}body{padding:0;font-size:10pt;line-height:1.45;print-color-adjust:exact;
-webkit-print-color-adjust:exact}#header,#content,#footer{max-width:none;padding:0}#header{padding-top:0}
#header>h1{border-top:0;padding:0;text-align:center;font-size:30pt;line-height:1.15}#header::after{display:none}
#toc{position:static;width:auto;padding:0;margin:14pt 0 0;background:none;border:0}
#toctitle{font-size:18pt;font-variant:normal;letter-spacing:0;color:var(--accent);border:0;padding:0;margin:0 0 8pt}
#toc ul{font-size:10pt;margin:0;line-height:1.5}#toc ul ul{border:0;margin-left:1.2em;padding-left:0}
#toc a{color:var(--ink);font-weight:400}#toc .sectlevel1>li>a{color:var(--ink);font-weight:400}
#toc .sectlevel1>li{margin-top:.15em}#toc li{margin-top:.15em}
#toc .leader{display:block;flex:1 1 auto;margin:0 .15em .28em .3em;border-bottom:1px dotted #9aa3b0}
#toc .page{display:inline;text-align:right}#toc .page:empty,#toc .leader:has(+ .page:empty){display:none}
#content{margin-top:16pt}h2{border-top:0;padding-top:0;margin-top:20pt;break-after:avoid}h3{border-bottom:0;
padding-bottom:0;break-after:avoid}.controls,.downloads{display:none}.table-wrap{overflow:visible}
a{color:inherit;border:0}table.tableblock{font-size:8.6pt}table.tableblock th,table.tableblock td{padding:.3em .5em}
tr,.figure,.admonitionblock,table.facts{break-inside:avoid}.notice>.title,.notice-packages{break-after:avoid}
.notice{break-inside:avoid}
.license-text{columns:2;column-gap:7mm;font-size:7.4pt;line-height:1.35;background:none;border:0;padding:0}
#footer{margin-top:16pt;padding:6pt 0 0}}
`

/** Table filtering, sorting and the embedded downloads. The document reads completely without it. */
export const REPORT_SCRIPT: string = `
(function(){
var data=JSON.parse(document.getElementById('report-data').textContent);
function save(name,type,text){var blob=new Blob([text],{type:type});var link=document.createElement('a');
link.href=URL.createObjectURL(blob);link.download=name;document.body.appendChild(link);link.click();
setTimeout(function(){URL.revokeObjectURL(link.href);link.remove();},0);}
document.querySelectorAll('[data-download]').forEach(function(button){button.hidden=false;
button.addEventListener('click',function(){var key=button.getAttribute('data-download');
save(button.getAttribute('data-file'),key==='sbom'?'application/vnd.cyclonedx+json':'text/csv',data[key]);});});
var table=document.getElementById('inventory-table');if(!table){return;}
var body=table.tBodies[0];var rows=Array.prototype.slice.call(body.rows);
var search=document.getElementById('filter-text');var scope=document.getElementById('filter-scope');
var kind=document.getElementById('filter-class');var shown=document.getElementById('filter-count');
function apply(){var needle=search.value.trim().toLowerCase();var visible=0;rows.forEach(function(row){
var match=(!needle||row.textContent.toLowerCase().indexOf(needle)>=0)&&(!scope.value||row.dataset.scope===scope.value)
&&(!kind.value||row.dataset.class===kind.value);row.hidden=!match;if(match){visible++;}});
shown.textContent=visible+' of '+rows.length+' package versions';}
[search,scope,kind].forEach(function(control){control.addEventListener('input',apply);});
table.querySelectorAll('th[data-sort]').forEach(function(header,index){header.tabIndex=0;
function sort(){var ascending=header.getAttribute('aria-sort')!=='ascending';
table.querySelectorAll('th').forEach(function(other){other.removeAttribute('aria-sort');});
header.setAttribute('aria-sort',ascending?'ascending':'descending');
rows.sort(function(left,right){var a=left.cells[index].textContent;var b=right.cells[index].textContent;
return (ascending?1:-1)*a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});});
rows.forEach(function(row){body.appendChild(row);});}
header.addEventListener('click',sort);header.addEventListener('keydown',function(event){
if(event.key==='Enter'||event.key===' '){event.preventDefault();sort();}});});
apply();})();
`
