import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { CONFIG, ROOT, assertFoundation, requireValue } from './config.mjs';

const exec = promisify(execFile);
export const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function parseJson(text, operation) {
  try { return JSON.parse(text); } catch {
    throw new Error(`${operation} returned invalid JSON. Response contents are not logged.`);
  }
}

export class AzureError extends Error {
  constructor(operation, status, code = '') {
    super(`${operation} failed (${status}${code ? `, ${code}` : ''}). No credentials or response bodies were logged.`);
    this.status = status;
    this.code = code;
  }
}

export class Azure {
  constructor({ execute = exec, fetcher = fetch, env = process.env, now = Date.now } = {}) {
    this.execute = execute;
    this.fetcher = fetcher;
    this.env = env;
    this.now = now;
    this.tokens = new Map();
    this.verified = false;
    this.foundationConfig = null;
  }

  async command(file, args, { sensitive = false, live = false, signal } = {}) {
    try {
      const result = await this.execute(file, args, {
        cwd: ROOT, env: this.env, maxBuffer: 32 * 1024 * 1024, signal,
      });
      if (live && result.stdout) process.stdout.write(result.stdout);
      if (live && result.stderr) process.stderr.write(result.stderr);
      return result.stdout;
    } catch (error) {
      // Azure errors can echo secure deployment inputs. Never forward arbitrary CLI output.
      if (live && !sensitive) {
        if (error.stdout) process.stdout.write(error.stdout);
        if (error.stderr) process.stderr.write(error.stderr);
      }
      throw new AzureError(`${file} ${args[0] ?? ''} ${args[1] ?? ''}`, error.code ?? 'execution error');
    }
  }

  async guard() {
    const context = this.env.AZURE_CONFIG_DIR;
    requireValue(typeof context === 'string' && isAbsolute(context)
      && resolve(context) !== resolve(homedir(), '.azure'),
    'Set AZURE_CONFIG_DIR to an explicit isolated Azure CLI directory; the global context is forbidden.');
    const account = parseJson(await this.command('az', ['account', 'show', '--only-show-errors', '--output', 'json']), 'Account inspection');
    requireValue(account.id === CONFIG.subscriptionId, 'The current Azure CLI subscription is not the approved TEST subscription. Nothing was changed.');
    requireValue(account.tenantId === CONFIG.tenantId && account.state === 'Enabled', 'The TEST tenant or subscription state is unexpected.');
    this.verified = true;
    return account;
  }

  async az(args, { mutate = false, raw = false, sensitive = false, signal } = {}) {
    if (mutate || !this.verified) await this.guard();
    const result = await this.command('az', [
      ...args, '--subscription', CONFIG.subscriptionId, '--only-show-errors', '--output', raw ? 'tsv' : 'json',
    ], { sensitive, signal });
    return raw ? result.trim() : (result.trim() ? parseJson(result, 'Azure CLI') : null);
  }

  async token(resource) {
    requireValue(this.verified, 'Azure scope must be verified before requesting a token.');
    const cached = this.tokens.get(resource);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    this.tokens.delete(resource);
    const token = await this.az([
      'account', 'get-access-token', '--resource', resource,
      '--query', '{accessToken:accessToken,expires_on:expires_on}',
    ], { sensitive: true });
    const value = token?.accessToken;
    requireValue(typeof value === 'string' && value.length > 100, 'Azure CLI did not provide an access token.');
    const expiry = token?.expires_on;
    requireValue((typeof expiry === 'number' && Number.isSafeInteger(expiry))
      || (typeof expiry === 'string' && /^\d+$/.test(expiry)), 'Azure CLI returned a missing or invalid numeric token expiry.');
    const expiresAt = Number(expiry) * 1000 - 60_000;
    requireValue(Number.isSafeInteger(expiresAt) && expiresAt > this.now(), 'Azure access token is expired or too close to expiry.');
    this.tokens.set(resource, { value, expiresAt });
    return value;
  }

  async request(url, { method = 'GET', body, headers = {}, allowed = [200], audience = 'https://management.azure.com/', signal, timeout = 20_000 } = {}) {
    requireValue(this.verified, 'Azure scope must be verified before API access.');
    const target = new URL(url);
    if (audience === 'https://management.azure.com/') {
      requireValue(target.origin === 'https://management.azure.com'
        && target.pathname.toLowerCase().startsWith(`/subscriptions/${CONFIG.subscriptionId}/`),
      'Refusing an ARM URL outside the approved subscription.');
    } else {
      requireValue(this.foundationConfig, 'Foundation endpoints must be verified before data-plane access.');
      const allowedOrigin = audience === 'https://storage.azure.com/'
        ? new URL(this.foundationConfig.stateUrl).origin
        : audience === 'https://vault.azure.net' ? new URL(this.foundationConfig.vaultUri).origin : '';
      requireValue(allowedOrigin && target.origin === allowedOrigin, 'Refusing an unapproved data-plane endpoint.');
    }
    let response;
    try {
      response = await this.fetcher(url, {
        method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        headers: {
          Authorization: `Bearer ${await this.token(audience)}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
    } catch (error) {
      throw new AzureError(`${method} ${target.hostname}`, error.name ?? 'network error');
    }
    const text = await response.text();
    let parsed = null;
    if (text && response.headers.get('content-type')?.includes('json')) parsed = parseJson(text, 'Azure API');
    if (!allowed.includes(response.status)) {
      const code = parsed?.error?.code ?? response.headers.get('x-ms-error-code') ?? '';
      throw new AzureError(`${method} ${target.pathname}`, response.status, /^[\w.-]+$/.test(code) ? code : '');
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  arm(path, options = {}) {
    return this.request(`https://management.azure.com${path}`, options);
  }

  async foundation() {
    const output = await this.az([
      'deployment', 'group', 'show', '--resource-group', CONFIG.dataGroup, '--name', 'called-it-test-data',
      '--query', 'properties.outputs.configuration.value',
    ]);
    this.foundationConfig = assertFoundation(output);
    return output;
  }

  async compile(file) {
    return JSON.parse(await this.command('az', ['bicep', 'build', '--file', file, '--stdout', '--only-show-errors']));
  }
}
