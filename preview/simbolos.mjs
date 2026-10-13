/**
 * Busca funciones que se llaman pero no existen.
 *
 *   node preview/simbolos.mjs
 *
 * En Apps Script los módulos HTML comparten un único ámbito global, así que
 * nada avisa de una función que no está: el error aparece recién cuando una
 * rama se ejecuta de verdad. Dos veces se escapó así —setText y
 * setChartEmpty—, las dos en ramas que los datos simulados nunca tocan: la
 * vista sin meses cerrados, el gráfico sin días hábiles suficientes.
 *
 * Esto recorre el código como texto y compara lo que se llama contra lo que
 * se define, sin tener que ejecutar nada.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'apps-script');

// Lo que el navegador ya trae. No es la lista completa de nada: es lo que
// este código usa, y crece cuando haga falta.
const NAVEGADOR = new Set([
  'Array', 'Boolean', 'Date', 'Error', 'JSON', 'Math', 'Number', 'Object',
  'Promise', 'RegExp', 'String', 'Set', 'Map', 'Intl', 'Proxy', 'Reflect',
  'alert', 'confirm', 'prompt', 'console', 'document', 'window', 'navigator',
  'location', 'localStorage', 'sessionStorage', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'getComputedStyle',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'escape', 'unescape', 'Function', 'Symbol',
  'google', 'matchMedia', 'URL', 'Blob', 'FormData', 'fetch', 'structuredClone',
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'function',
  'of', 'in', 'do', 'else', 'try', 'throw', 'delete', 'void', 'case',
  // include() vive en Codigo.gs: la plantilla la llama desde el servidor,
  // antes de que el HTML llegue al navegador.
  'include'
]);

const modulos = readdirSync(src)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => f !== 'Estilos.html');

const definidas = new Set();
const llamadas = new Map();

// Primera pasada: todo lo que el conjunto define.
for (const archivo of modulos) {
  const texto = readFileSync(join(src, archivo), 'utf8');

  for (const m of texto.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    definidas.add(m[1]);
  }

  // var x = function(){}, const x = () => {}, var x = 5
  for (const m of texto.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    definidas.add(m[1]);
  }

  // Parámetros y variables de bucle: cualquier nombre que esté entre
  // paréntesis de una función o declarado suelto.
  for (const m of texto.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
    m[1].split(',').forEach((p) => {
      const nombre = p.trim().split(/[\s=]/)[0];
      if (nombre) { definidas.add(nombre); }
    });
  }

  for (const m of texto.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\b/g)) {
    definidas.add(m[1]);
  }

  for (const m of texto.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
    definidas.add(m[1]);
  }
}

/**
 * Borra comentarios y cadenas dejando los saltos de línea en su sitio, para
 * que los números de línea sigan siendo los del archivo. Hace falta porque
 * la prosa en español trae paréntesis a montones: "el predio (o el rol)" se
 * lee como una llamada a predio() si no se limpia.
 */
function soloCodigo(texto) {
  const enBlanco = (m) => m.replace(/[^\n]/g, ' ');

  return texto
    .replace(/\/\*[\s\S]*?\*\//g, enBlanco)
    .replace(/<!--[\s\S]*?-->/g, enBlanco)
    .replace(/\/\/[^\n]*/g, enBlanco)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, enBlanco)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, enBlanco);
}

// Segunda pasada: todo lo que se llama como función.
for (const archivo of modulos) {
  const lineas = soloCodigo(readFileSync(join(src, archivo), 'utf8')).split('\n');

  lineas.forEach((limpia, i) => {

    for (const m of limpia.matchAll(/(^|[^\w$.])([a-zA-Z_$][\w$]*)\s*\(/g)) {
      const nombre = m[2];

      if (NAVEGADOR.has(nombre) || definidas.has(nombre)) { continue; }

      if (!llamadas.has(nombre)) { llamadas.set(nombre, []); }
      llamadas.get(nombre).push(`${archivo}:${i + 1}`);
    }
  });
}

if (!llamadas.size) {
  console.log(
    `sin funciones fantasma · ${definidas.size} nombres definidos en ` +
    `${modulos.length} módulos`
  );
  process.exit(0);
}

console.log('FUNCIONES QUE SE LLAMAN PERO NO EXISTEN:\n');

for (const [nombre, sitios] of llamadas) {
  console.log(`  ${nombre}()`);
  sitios.forEach((s) => console.log(`      ${s}`));
}

console.log(`\n${llamadas.size} sin definir`);
process.exit(1);
