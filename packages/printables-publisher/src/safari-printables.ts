import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TabCoordinator } from '../../medium-automation/src/automation/tab-coordinator.js';
import type { PublishJob, SelectorContract } from './types.js';

type SafariLaneClient = {
  runClaimedSafariAppleScript(
    windowId: number,
    tabIndex: number,
    mode: 'background' | 'interactive',
    actionBody: string,
    options?: { preamble?: string; timeoutMs?: number },
  ): Promise<string>;
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTRACT = path.resolve(MODULE_DIR, '../selectors/printables.v1.json');
const CREATE_FIELDS = ['title', 'description', 'license', 'category', 'fileInput', 'imageInput', 'saveDraft'];

function appleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replaceAll('</', '<\\/');
}

export class PrintablesSafari {
  private readonly coordinator: TabCoordinator;

  constructor(
    private readonly port: number,
    private readonly contractPath = process.env.PRINTABLES_SELECTOR_CONTRACT || DEFAULT_CONTRACT,
  ) {
    this.coordinator = new TabCoordinator(
      `printables-publisher-${process.pid}`,
      'printables-publisher',
      port,
      'printables.com',
      'https://www.printables.com/',
    );
  }

  async contract(): Promise<SelectorContract> {
    return JSON.parse(await readFile(this.contractPath, 'utf8')) as SelectorContract;
  }

  private async client(): Promise<SafariLaneClient> {
    const clientPath = '../../../shared/safari-lane-client.js';
    return await import(clientPath) as SafariLaneClient;
  }

  private requireVerifiedContract(contract: SelectorContract, includePublish = false): void {
    if (contract.status !== 'verified' || !contract.createUrl || !contract.verifiedAt) {
      throw new Error('Printables selector contract is pending live Safari capture');
    }
    const required = includePublish ? [...CREATE_FIELDS, 'publish'] : CREATE_FIELDS;
    for (const key of required) {
      if (!contract.selectors[key]) throw new Error(`Verified selector contract is missing ${key}`);
    }
    const create = new URL(contract.createUrl);
    if (create.protocol !== 'https:' || create.hostname !== contract.host) throw new Error('Selector contract create URL is outside Printables');
  }

  private async withClaim<T>(operation: (claim: { windowId?: number; tabIndex: number }) => Promise<T>): Promise<T> {
    const claim = await this.coordinator.beginOperation();
    try {
      if (!claim.windowId) throw new Error('Safari claim lacks stable window id');
      return await operation(claim);
    } finally {
      await this.coordinator.endOperation();
    }
  }

  async status(): Promise<Record<string, unknown>> {
    const contract = await this.contract();
    try {
      return await this.withClaim(async claim => {
        const client = await this.client();
        const output = await client.runClaimedSafariAppleScript(
          claim.windowId!, claim.tabIndex, 'background',
          'return (URL of agentTab) & "||" & (name of agentTab)',
        );
        const [url, title] = output.trim().split('||');
        return { available: true, url, title, selectorContract: contract.status };
      });
    } catch (error) {
      return { available: false, error: String(error), selectorContract: contract.status };
    }
  }

  async inspect(): Promise<Record<string, unknown>> {
    return this.withClaim(async claim => {
      const client = await this.client();
      const script = `
const inputs = [...document.querySelectorAll('input,textarea,select,button,[contenteditable="true"]')].map((el, index) => ({
  index,
  tag: el.tagName.toLowerCase(),
  type: el.getAttribute('type'),
  name: el.getAttribute('name'),
  id: el.id || null,
  ariaLabel: el.getAttribute('aria-label'),
  placeholder: el.getAttribute('placeholder'),
  text: (el.innerText || '').trim().slice(0, 120)
}));
JSON.stringify({ url: location.href, title: document.title, inputs });`;
      const output = await client.runClaimedSafariAppleScript(
        claim.windowId!, claim.tabIndex, 'background',
        `return do JavaScript ${jsLiteral(script)} in agentTab`,
      );
      return JSON.parse(output) as Record<string, unknown>;
    });
  }

  async prepareDraft(job: PublishJob): Promise<{ draftUrl: string }> {
    if (!job.release) throw new Error('Job has no validated release');
    const contract = await this.contract();
    this.requireVerifiedContract(contract);
    return this.withClaim(async claim => {
      const client = await this.client();
      await client.runClaimedSafariAppleScript(
        claim.windowId!, claim.tabIndex, 'background',
        `set URL of agentTab to "${appleScriptString(contract.createUrl!)}"`,
      );
      throw new Error('Live Printables file-upload behavior has not yet been verified in Safari; no external draft was created');
    });
  }

  async publish(job: PublishJob): Promise<{ publishedUrl: string }> {
    const contract = await this.contract();
    this.requireVerifiedContract(contract, true);
    void job;
    throw new Error('Printables publication remains disabled until a live draft round-trip is verified');
  }
}
