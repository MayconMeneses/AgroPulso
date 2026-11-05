import type { KeyValueStore } from '../storage/key-value.ts';
import { evaluateLicense, verifyLicense } from './license.ts';
import type { LicenseStatus, TrustedKeys, VerifyResult } from './license.ts';

// Junta a conferência da chave (license.ts) com o que fica guardado no aparelho. Tudo vai para uma KeyValueStore separada
// do SQLite: a licença não viaja na cópia de segurança e restaurar uma cópia não troca a licença nem volta o relógio.

const K_LICENSE = 'license';
const K_INSTALLED = 'installed_on';
const K_SEEN = 'seen_on';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface LicenseView {
  enforced: boolean; // false: o app não cobra nada (chave geral desligada)
  status: LicenseStatus;
}

async function readDate(store: KeyValueStore, key: string): Promise<string | undefined> {
  const v = await store.get(key);
  return v !== null && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined;
}

export async function readStoredLicense(store: KeyValueStore, trusted: TrustedKeys): Promise<VerifyResult | null> {
  const text = await store.get(K_LICENSE);
  return text === null ? null : verifyLicense(text, trusted);
}

// Carrega o estado. Com a chave geral desligada, nada é gravado (o teste de 7 dias só começa a contar quando a cobrança
// ligar) e escrever é sempre permitido; uma licença já ativada ainda aparece na tela, só para informar.
export async function loadLicense(store: KeyValueStore, trusted: TrustedKeys, today: string, enforced: boolean): Promise<LicenseView> {
  const license = await readStoredLicense(store, trusted);
  if (!enforced) {
    if (license?.ok) {
      const shown = evaluateLicense({ license, installedOn: today, today });
      return { enforced: false, status: { ...shown, canWrite: true } };
    }
    return { enforced: false, status: { state: 'sem_chave', canWrite: true, daysLeft: null, seenOn: today, message: 'A licença ainda não é exigida neste app.' } };
  }
  let installedOn = await readDate(store, K_INSTALLED);
  if (!installedOn) {
    installedOn = today; // primeira vez com a cobrança ligada: o teste começa agora
    await store.set(K_INSTALLED, installedOn);
  }
  const latestSeenOn = await readDate(store, K_SEEN);
  const status = evaluateLicense({ license, installedOn, today, latestSeenOn });
  if (status.seenOn !== latestSeenOn) await store.set(K_SEEN, status.seenOn);
  return { enforced: true, status };
}

// Confere a chave digitada ou vinda do link e, se for boa, guarda. Chave ruim não é guardada.
export async function activateLicense(store: KeyValueStore, text: string, trusted: TrustedKeys): Promise<VerifyResult> {
  const result = await verifyLicense(text, trusted);
  if (result.ok) await store.set(K_LICENSE, text.replace(/\s+/g, ''));
  return result;
}
