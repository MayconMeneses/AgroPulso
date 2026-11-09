import assert from 'node:assert/strict';
import { test } from 'node:test';
import initSqlJs from 'sql.js';
import { openBrowserSqlite } from '../src/storage/browser-sqlite.ts';
import type { SqlJsStatic } from '../src/storage/browser-sqlite.ts';
import { StorageError } from '../src/storage/saver.ts';

// IndexedDB de mentira: uma gaveta só, com os eventos que o adaptador usa. Basta para exercitar a ordem da
// transação e a falha de gravação sem navegador.
const gaveta = new Map<string, unknown>();
let failWrites = false;

(globalThis as any).indexedDB = {
  open(_name: string) {
    const req: any = {};
    const db: any = {
      onversionchange: null,
      createObjectStore() {},
      close() {},
      transaction(_store: string, mode?: string) {
        const tx: any = { error: null, oncomplete: null, onerror: null };
        tx.objectStore = () => ({
          get(key: string) {
            const r: any = {};
            const value = gaveta.get(key);
            queueMicrotask(() => {
              r.result = value;
              r.onsuccess?.();
            });
            return r;
          },
          put(value: unknown, key: string) {
            if (failWrites && mode === 'readwrite') {
              queueMicrotask(() => {
                tx.error = new Error('quota');
                tx.onerror?.();
              });
              return;
            }
            gaveta.set(key, value);
            queueMicrotask(() => tx.oncomplete?.());
          },
        });
        return tx;
      },
    };
    req.result = db;
    queueMicrotask(() => req.onsuccess?.());
    return req;
  },
};

const SQL = (await initSqlJs()) as unknown as SqlJsStatic;

test('transação grava no IndexedDB e sobrevive à reabertura', async () => {
  const db = await openBrowserSqlite(SQL);
  await db.exec('create table persistida (id integer primary key, v text)');
  await db.transaction(async () => {
    await db.run("insert into persistida (v) values ('a')");
  });

  const outra = await openBrowserSqlite(SQL);
  assert.deepEqual(await outra.all('select v from persistida'), [{ v: 'a' }]);
});

test('erro dentro de fn desfaz a transação', async () => {
  const db = await openBrowserSqlite(SQL);
  await db.exec('create table desfeita (id integer primary key, v text)');
  await assert.rejects(
    db.transaction(async () => {
      await db.run("insert into desfeita (v) values ('x')");
      throw new Error('falhou de propósito');
    }),
    /falhou de propósito/,
  );
  assert.deepEqual(await db.all('select v from desfeita'), []);
});

test('falha ao persistir depois do COMMIT desfaz a transação', async () => {
  const db = await openBrowserSqlite(SQL);
  await db.exec('create table falha (id integer primary key, v text)');
  await db.transaction(async () => {
    await db.run("insert into falha (v) values ('antes')");
  });

  failWrites = true;
  await assert.rejects(
    db.transaction(async () => {
      await db.run("insert into falha (v) values ('depois')");
    }),
    (error: unknown) => error instanceof StorageError,
  );
  failWrites = false;

  assert.deepEqual(await db.all('select v from falha'), [{ v: 'antes' }]);
  const outra = await openBrowserSqlite(SQL);
  assert.deepEqual(await outra.all('select v from falha'), [{ v: 'antes' }]);
});

test('depois da falha de persistência a conexão continua utilizável', async () => {
  const db = await openBrowserSqlite(SQL);
  await db.exec('create table retomada (id integer primary key, v text)');

  failWrites = true;
  await assert.rejects(
    db.transaction(async () => {
      await db.run("insert into retomada (v) values ('perdida')");
    }),
    (error: unknown) => error instanceof StorageError,
  );
  failWrites = false;

  await db.transaction(async () => {
    await db.run("insert into retomada (v) values ('salva')");
  });
  assert.deepEqual(await db.all('select v from retomada'), [{ v: 'salva' }]);
});

test('close propaga a falha de gravação e pode ser repetido', async () => {
  const db = await openBrowserSqlite(SQL);
  await db.exec('create table fechada (id integer primary key)');

  failWrites = true;
  await assert.rejects(db.close(), (error: unknown) => error instanceof StorageError);
  failWrites = false;

  await db.close();
  const outra = await openBrowserSqlite(SQL);
  assert.deepEqual(await outra.all('select name from sqlite_master where name = ?', ['fechada']), [{ name: 'fechada' }]);
});

