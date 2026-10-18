/* eslint-disable no-console */
/**
 * Renders every docs/diagrams/*.mmd to .svg (for the docs) and .png (for the
 * report), using Mermaid inside a headless Microsoft Edge.
 *
 * Not a project dependency - run it from any folder that has the two packages:
 *
 *   npm install playwright-core@1.48.2 mermaid@10.9.1
 *   node <repo>/docs/diagrams/render.js
 *
 * EDGE can be overridden with the path to any Chromium-based browser.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright-core', { paths: [process.cwd()] }));

const DIR = __dirname;
const MERMAID = require.resolve('mermaid/dist/mermaid.min.js', { paths: [process.cwd()] });
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><div id="out"></div></body></html>');
  await page.addScriptTag({ path: MERMAID });
  await page.evaluate(() => window.mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    themeVariables: {
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: '16px',
      primaryColor: '#eef0fc',
      primaryBorderColor: '#6b7bd6',
      primaryTextColor: '#1f2430',
      lineColor: '#626c82',
      secondaryColor: '#e6f5f3',
      tertiaryColor: '#fdf3e4',
    },
    er: { useMaxWidth: false },
    flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
    class: { useMaxWidth: false },
  }));

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mmd'));
  let failed = 0;
  for (const file of files) {
    const name = file.replace(/\.mmd$/, '');
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    try {
      const svg = await page.evaluate(async ([id, text]) => {
        const { svg: out } = await window.mermaid.render(id, text);
        document.getElementById('out').innerHTML = out;
        return out;
      }, [`d_${name.replace(/\W/g, '_')}`, src]);
      fs.writeFileSync(path.join(DIR, `${name}.svg`), svg);
      const el = await page.$('#out svg');
      await el.screenshot({ path: path.join(DIR, `${name}.png`), omitBackground: false });
      const box = await el.boundingBox();
      console.log(`  ok  ${file} -> ${name}.svg, ${name}.png (${Math.round(box.width)} x ${Math.round(box.height)})`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL ${file}: ${err.message.split('\n')[0]}`);
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
