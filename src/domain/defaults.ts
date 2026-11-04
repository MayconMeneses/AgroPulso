import type { Database } from '../storage/database.ts';
import { recordEvent } from './audit.ts';
import type { UnitKind } from './units.ts';

// Listas para o primeiro uso não começarem vazias. São só NOMES: nenhum fator de conversão vem pronto (uma saca ou uma tarefa
// muda de tamanho por cultura e por região, e quem cadastra o fator escreve de onde ele veio, RN-AG-011). Tudo continua do
// usuário (RN-AG-019): pode acrescentar os seus. Quem já tem um item com o mesmo nome não recebe repetido, e a marca no banco
// impede de oferecer de novo, então nada que a pessoa mude depois volta sozinho.
// "Mão de obra" é o nome que o lançamento automático de trabalho procura.
export const COMMON_CATEGORIES = [
  'Adubo e corretivos', 'Sementes e mudas', 'Defensivos', 'Mão de obra', 'Combustível', 'Água e energia', 'Manutenção de máquinas', 'Transporte', 'Embalagens', 'Outros',
];
export const COMMON_UNITS: [string, UnitKind][] = [
  ['kg', 'massa'], ['tonelada', 'massa'], ['saca', 'massa'], ['litro', 'volume'], ['hectare', 'area'], ['tarefa', 'area'], ['unidade', 'contagem'], ['caixa', 'contagem'],
];

export async function addCommonCategoriesAndUnits(db: Database): Promise<{ categories: number; units: number }> {
  return db.transaction(async () => {
    const done = async (key: string) => (await db.all('select 1 as ok from app_meta where key = ?', [key])).length > 0;
    const mark = (key: string) => db.run('insert into app_meta (key, value) values (?, ?)', [key, new Date().toISOString()]);
    let categories = 0;
    let units = 0;
    if (!(await done('categorias_iniciais'))) {
      for (const name of COMMON_CATEGORIES) {
        if ((await db.all('select 1 as ok from cost_category where lower(name) = lower(?)', [name])).length > 0) continue;
        const id = crypto.randomUUID();
        await db.run('insert into cost_category (id, name) values (?, ?)', [id, name]);
        await recordEvent(db, { type: 'cost_category.created', resource: 'cost_category', resourceId: id, reason: 'categoria comum oferecida no primeiro uso', after: { name } });
        categories++;
      }
      await mark('categorias_iniciais');
    }
    if (!(await done('unidades_iniciais'))) {
      for (const [name, kind] of COMMON_UNITS) {
        if ((await db.all('select 1 as ok from unit where lower(name) = lower(?)', [name])).length > 0) continue;
        const id = crypto.randomUUID();
        await db.run('insert into unit (id, name, kind) values (?, ?, ?)', [id, name, kind]);
        await recordEvent(db, { type: 'unit.created', resource: 'unit', resourceId: id, reason: 'unidade comum oferecida no primeiro uso', after: { name, kind } });
        units++;
      }
      await mark('unidades_iniciais');
    }
    return { categories, units };
  });
}
