// Junta os módulos ES do app em UM arquivo, sem dependências: cada módulo vira uma função (escopo próprio,
// então nomes iguais em módulos diferentes não colidem) e roda depois dos módulos de que depende.
// Só entende o que o código do projeto usa: `import { a, b as c } from './x.js'` e
// `export function | async function | const | class`. Qualquer outra forma faz o build falhar de propósito.
import { posix } from 'node:path';

export function bundle(entry, modules) {
  const order = [];
  const state = new Map(); // key -> 'visiting' | 'done'
  const compiled = new Map();

  function compile(key, src) {
    const exportsList = [];
    let code = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm, (_m, names, spec) => {
      const dep = posix.normalize(posix.join(posix.dirname(key), spec));
      const mapped = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ');
      return `const { ${mapped} } = __mods[${JSON.stringify(dep)}];`;
    });
    code = code.replace(/^export\s+(async\s+function\s+|function\s+|const\s+|class\s+)([A-Za-z_$][\w$]*)/gm, (_m, kw, name) => {
      exportsList.push(name);
      return kw + name;
    });
    if (/^\s*(import|export)\s/m.test(code)) throw new Error(`${key}: forma de import/export não suportada pelo bundle`);
    return { code, exportsList };
  }

  function visit(key) {
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'visiting') throw new Error(`Dependência circular em ${key}`);
    state.set(key, 'visiting');
    const src = modules.get(key);
    if (src === undefined) throw new Error(`Módulo não encontrado: ${key}`);
    const c = compile(key, src);
    for (const m of c.code.matchAll(/__mods\["([^"]+)"\]/g)) visit(m[1]);
    compiled.set(key, c);
    order.push(key);
    state.set(key, 'done');
  }
  visit(entry);

  const parts = ['const __mods = {};'];
  for (const key of order) {
    const { code, exportsList } = compiled.get(key);
    parts.push(`__mods[${JSON.stringify(key)}] = (() => {\n${code}\nreturn { ${exportsList.join(', ')} };\n})();`);
  }
  return `${parts.join('\n')}\n`;
}
