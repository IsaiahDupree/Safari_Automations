import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PublishJob, SelectorContract } from './types.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTRACT = path.resolve(MODULE_DIR, '../selectors/printables.v1.json');
const CREATE_FIELDS = [
  'title', 'summary', 'description', 'license', 'category', 'tags',
  'authorshipOriginal', 'authorshipRemix', 'remixSource', 'remixDifferences',
  'aiUsed', 'fileInput', 'imageInput', 'saveDraft',
];
const execFileAsync = promisify(execFile);
// System Events keystrokes go to whichever app is frontmost, not to the named
// process. Refuse to type if another app (or a locked screen) holds focus.
// Fully qualified so it resolves both inside and outside `tell process "Safari"`.
const SAFARI_FOCUS_GUARD =
  'if not (frontmost of application process "Safari" of application "System Events") then error "Safari lost keyboard focus; refusing to type into another app"';

function appleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replaceAll('</', '<\\/');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class PrintablesSafari {
  constructor(
    _port: number,
    private readonly contractPath = process.env.PRINTABLES_SELECTOR_CONTRACT || DEFAULT_CONTRACT,
  ) {}

  async contract(): Promise<SelectorContract> {
    return JSON.parse(await readFile(this.contractPath, 'utf8')) as SelectorContract;
  }

  private async runAppleScript(script: string, timeout = 30_000): Promise<string> {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim();
  }

  private async runTargeted(windowId: number, tabIndex: number, actionBody: string): Promise<string> {
    if (!Number.isInteger(windowId) || windowId <= 0 || !Number.isInteger(tabIndex) || tabIndex <= 0) {
      throw new Error('Safari target has an invalid window or tab identity');
    }
    return this.runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  if (count of tabs of agentWindow) < ${tabIndex} then error "Safari target tab is unavailable"
  set agentTab to tab ${tabIndex} of agentWindow
  ${actionBody}
end tell`);
  }

  private async javascript(windowId: number, tabIndex: number, script: string): Promise<string> {
    return this.runTargeted(windowId, tabIndex, `return do JavaScript ${jsLiteral(script)} in agentTab`);
  }

  private requireContract(contract: SelectorContract, includePublish = false): void {
    const ready = includePublish ? contract.status === 'verified' : ['captured', 'verified'].includes(contract.status);
    if (!ready || !contract.createUrl || !contract.capturedAt) {
      throw new Error(includePublish
        ? 'Printables publication requires a verified selector contract'
        : 'Printables private draft requires a captured selector contract');
    }
    if (includePublish && !contract.verifiedAt) {
      throw new Error('Printables publication requires a verified live draft round-trip');
    }
    const required = includePublish ? [...CREATE_FIELDS, 'publish'] : CREATE_FIELDS;
    for (const key of required) {
      if (!contract.selectors[key]) throw new Error(`Selector contract is missing ${key}`);
    }
    const create = new URL(contract.createUrl);
    if (create.protocol !== 'https:' || create.hostname !== contract.host) {
      throw new Error('Selector contract create URL is outside Printables');
    }
  }

  /** Find a matching Printables tab across all Safari windows, or open one. */
  private async withTarget<T>(
    createUrl: string,
    operation: (target: { windowId: number; tabIndex: number }) => Promise<T>,
  ): Promise<T> {
    const targetText = await this.runAppleScript(`
tell application "Safari"
  repeat with candidateWindow in windows
    repeat with t from 1 to count of tabs of candidateWindow
      try
        if URL of tab t of candidateWindow contains "printables.com/model/create" then
          return (id of candidateWindow as text) & "||" & (t as text)
        end if
      end try
    end repeat
  end repeat

  if (count of windows) is 0 then
    make new document with properties {URL:"${appleScriptString(createUrl)}"}
    set agentWindow to front window
    set targetTab to 1
  else
    set agentWindow to front window
    tell agentWindow to make new tab with properties {URL:"${appleScriptString(createUrl)}"}
    set targetTab to count of tabs of agentWindow
  end if
  return (id of agentWindow as text) & "||" & (targetTab as text)
end tell`);
    const [windowIdText, tabText] = targetText.split('||');
    const windowId = Number.parseInt(windowIdText, 10);
    const tabIndex = Number.parseInt(tabText, 10);
    if (!Number.isInteger(windowId) || !Number.isInteger(tabIndex)) {
      throw new Error(`Safari returned an invalid target: ${targetText}`);
    }
    return operation({ windowId, tabIndex });
  }

  /** Resolve one exact existing Printables model editor, or open that URL in Safari. */
  private async withModelTarget<T>(
    targetUrl: string,
    operation: (target: { windowId: number; tabIndex: number }) => Promise<T>,
  ): Promise<T> {
    const target = new URL(targetUrl);
    if (target.protocol !== 'https:' || target.hostname !== 'www.printables.com'
      || !/^\/model\/\d+\/edit$/.test(target.pathname)) {
      throw new Error('Printables draft URL is not an exact model editor URL');
    }
    const targetText = await this.runAppleScript(`
tell application "Safari"
  repeat with candidateWindow in windows
    repeat with t from 1 to count of tabs of candidateWindow
      try
        if URL of tab t of candidateWindow is "${appleScriptString(target.href)}" then
          return (id of candidateWindow as text) & "||" & (t as text)
        end if
      end try
    end repeat
  end repeat

  if (count of windows) is 0 then
    make new document with properties {URL:"${appleScriptString(target.href)}"}
    set agentWindow to front window
    set targetTab to 1
  else
    set agentWindow to front window
    tell agentWindow to make new tab with properties {URL:"${appleScriptString(target.href)}"}
    set targetTab to count of tabs of agentWindow
  end if
  return (id of agentWindow as text) & "||" & (targetTab as text)
end tell`);
    const [windowIdText, tabText] = targetText.split('||');
    const windowId = Number.parseInt(windowIdText, 10);
    const tabIndex = Number.parseInt(tabText, 10);
    if (!Number.isInteger(windowId) || !Number.isInteger(tabIndex)) {
      throw new Error(`Safari returned an invalid model target: ${targetText}`);
    }
    return operation({ windowId, tabIndex });
  }

  private async waitForForm(windowId: number, tabIndex: number, selector: string): Promise<void> {
    const deadline = Date.now() + 45_000;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const output = await this.javascript(windowId, tabIndex, `JSON.stringify({
        url: location.href,
        ready: document.readyState,
        signedIn: Boolean(document.querySelector('[data-testid="user-avatar"]')),
        form: Boolean(document.querySelector(${jsLiteral(selector)}))
      })`);
      const state = JSON.parse(output) as { url: string; ready: string; signedIn: boolean; form: boolean };
      if (state.url.startsWith('https://www.printables.com/model/create') && state.ready === 'complete' && state.signedIn && state.form) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= 2_000) return;
      } else {
        stableSince = 0;
      }
      await delay(750);
    }
    throw new Error('Timed out waiting for the authenticated Printables create-model form');
  }

  private async waitForModelForm(windowId: number, tabIndex: number, expectedUrl: string, selector: string): Promise<void> {
    const deadline = Date.now() + 45_000;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const output = await this.javascript(windowId, tabIndex, `JSON.stringify({
        url: location.href,
        ready: document.readyState,
        signedIn: Boolean(document.querySelector('[data-testid="user-avatar"]')),
        form: Boolean(document.querySelector(${jsLiteral(selector)}))
      })`);
      const state = JSON.parse(output) as { url: string; ready: string; signedIn: boolean; form: boolean };
      if (state.url === expectedUrl && state.ready === 'complete' && state.signedIn && state.form) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= 2_000) return;
      } else {
        stableSince = 0;
      }
      await delay(750);
    }
    throw new Error('Timed out waiting for the authenticated Printables model editor');
  }

  private async verifyPersistedModelFiles(windowId: number, filesUrl: string, expectedNames: string[]): Promise<boolean> {
    const tabIndexText = await this.runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  tell agentWindow to make new tab with properties {URL:"${appleScriptString(filesUrl)}"}
  return count of tabs of agentWindow
end tell`);
    const tabIndex = Number.parseInt(tabIndexText, 10);
    if (!Number.isInteger(tabIndex) || tabIndex <= 0) throw new Error('Safari did not create the file-verification tab');
    try {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const state = JSON.parse(await this.javascript(windowId, tabIndex, `JSON.stringify({
          ready:document.readyState,
          url:location.href,
          text:document.body?.innerText || ''
        })`)) as { ready: string; url: string; text: string };
        if (state.ready === 'complete' && /\/files(?:$|[?#])/.test(new URL(state.url).pathname)
          && expectedNames.every(name => state.text.includes(name))) return true;
        await delay(750);
      }
      return false;
    } finally {
      await this.runTargeted(windowId, tabIndex, 'close agentTab\n  return "closed"').catch(() => undefined);
    }
  }

  private async selectExactOption(
    windowId: number,
    tabIndex: number,
    controlSelector: string,
    optionText: string,
  ): Promise<void> {
    const deadline = Date.now() + 8_000;
    let clicked: { ok: boolean } = { ok: false };
    while (Date.now() < deadline && !clicked.ok) {
      clicked = JSON.parse(await this.javascript(windowId, tabIndex, `(() => {
        const control = document.querySelector(${jsLiteral(controlSelector)});
        if (!control) return JSON.stringify({ok:false});
        control.click();
        return JSON.stringify({ok:true});
      })()`)) as { ok: boolean };
      if (!clicked.ok) await delay(400);
    }
    if (!clicked.ok) throw new Error(`Could not open Printables option control ${controlSelector}`);
    await delay(500);
    const selected = JSON.parse(await this.javascript(windowId, tabIndex, `(() => {
      const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
      const expected = normalize(${jsLiteral(optionText)});
      const matches = [...document.querySelectorAll('button.option')]
        .filter(el => el.getClientRects().length && normalize(el.textContent) === expected);
      if (matches.length !== 1) return JSON.stringify({ok:false, count:matches.length});
      matches[0].click();
      return JSON.stringify({ok:true});
    })()`)) as { ok: boolean; count?: number };
    if (!selected.ok) throw new Error(`Expected one visible Printables option '${optionText}', found ${selected.count}`);
  }

  private async focusAndCoordinate(
    windowId: number,
    tabIndex: number,
    selector: string,
  ): Promise<{ x: number; y: number; text: string }> {
    await this.runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set agentTab to tab ${tabIndex} of agentWindow
  set current tab of agentWindow to agentTab
  set index of agentWindow to 1
  activate
end tell`);
    const coordinateText = await this.javascript(windowId, tabIndex, `(() => {
      const element = document.querySelector(${jsLiteral(selector)});
      if (!element) return JSON.stringify({ok:false});
      element.scrollIntoView({block:'center', inline:'center'});
      const rect = element.getBoundingClientRect();
      const chromeHeight = window.outerHeight - window.innerHeight;
      return JSON.stringify({ok:true,
        x:Math.round(window.screenX + rect.left + rect.width / 2),
        y:Math.round(window.screenY + chromeHeight + rect.top + rect.height / 2),
        text:(element.textContent || '').trim(), width:rect.width, height:rect.height});
    })()`);
    const coordinate = JSON.parse(coordinateText) as {
      ok: boolean; x: number; y: number; text: string; width: number; height: number;
    };
    if (!coordinate.ok || coordinate.width < 1 || coordinate.height < 1) {
      throw new Error(`Printables control could not be targeted: ${selector}`);
    }
    return coordinate;
  }

  private async enterTags(windowId: number, tabIndex: number, selector: string, tags: string[]): Promise<void> {
    const coordinate = await this.focusAndCoordinate(windowId, tabIndex, selector);
    await execFileAsync('/opt/homebrew/bin/cliclick', [`c:${coordinate.x},${coordinate.y}`], { timeout: 10_000 });
    await this.javascript(windowId, tabIndex, `(() => {
      const element = document.querySelector(${jsLiteral(selector)});
      element?.focus();
      return 'focused';
    })()`);
    await this.runAppleScript(`
tell application "System Events"
  ${SAFARI_FOCUS_GUARD}
  tell process "Safari"
    keystroke "a" using {command down}
    key code 51
    keystroke "${appleScriptString(`${tags.join(' ')} `)}"
  end tell
end tell`);
    await delay(750);
    const result = JSON.parse(await this.javascript(windowId, tabIndex, `(() => {
      const input = document.querySelector(${jsLiteral(selector)});
      // Read only the tag field's own chips; page text such as the title can contain tag words.
      const tagText = input?.parentElement?.innerText || '';
      return JSON.stringify({value:input?.value || '', found:${jsLiteral(tags)}.filter(tag => tagText.includes(tag))});
    })()`)) as { value: string; found: string[] };
    if (result.found.length !== tags.length || /\S/.test(result.value)) {
      throw new Error(`Printables tag entry failed: ${JSON.stringify(result)}`);
    }
  }

  private async enterRemixSources(
    windowId: number,
    tabIndex: number,
    selector: string,
    sources: Array<{ title: string; author: string; url: string }>,
  ): Promise<void> {
    for (const source of sources) {
      const availableDeadline = Date.now() + 10_000;
      let available = false;
      while (Date.now() < availableDeadline && !available) {
        available = JSON.parse(await this.javascript(windowId, tabIndex, `JSON.stringify({
          available:Boolean(document.querySelector(${jsLiteral(selector)}))
        })`)).available;
        if (!available) await delay(300);
      }
      if (!available) throw new Error('Printables remix-source field is unavailable');

      await this.javascript(windowId, tabIndex, `(() => {
        const input = document.querySelector(${jsLiteral(selector)});
        if (!(input instanceof HTMLInputElement)) return JSON.stringify({ok:false});
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${jsLiteral(source.url)});
        input.focus();
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
        return JSON.stringify({ok:true});
      })()`);

      const suggestionDeadline = Date.now() + 15_000;
      let suggestionReady = false;
      while (Date.now() < suggestionDeadline && !suggestionReady) {
        const state = JSON.parse(await this.javascript(windowId, tabIndex, `(() => {
          const input = document.querySelector(${jsLiteral(selector)});
          const text = document.body?.innerText || '';
          return JSON.stringify({
            focused:document.activeElement === input,
            exactValue:input?.value === ${jsLiteral(source.url)},
            hasTitle:text.includes(${jsLiteral(source.title)}),
            hasAuthor:text.includes(${jsLiteral(source.author)})
          });
        })()`)) as { focused: boolean; exactValue: boolean; hasTitle: boolean; hasAuthor: boolean };
        suggestionReady = state.focused && state.exactValue && state.hasTitle && state.hasAuthor;
        if (!suggestionReady) await delay(350);
      }
      if (!suggestionReady) throw new Error(`Printables did not resolve remix source: ${source.url}`);

      const clicked = JSON.parse(await this.javascript(windowId, tabIndex, `(() => {
        const expected = new URL(${jsLiteral(source.url)});
        const modelMatch = expected.hostname === 'www.printables.com'
          ? expected.pathname.match(/^\\/model\\/(\\d+)/)
          : null;
        const candidates = [...document.querySelectorAll('a[href]')].filter(anchor => {
          if (!anchor.getClientRects().length) return false;
          const link = new URL(anchor.href);
          const hrefMatches = modelMatch
            ? link.hostname === expected.hostname && link.pathname.startsWith('/model/' + modelMatch[1])
            : link.hostname === expected.hostname && link.pathname.replace(/\\/$/, '') === expected.pathname.replace(/\\/$/, '');
          const text = anchor.textContent || '';
          return hrefMatches && text.includes(${jsLiteral(source.title)}) && text.includes(${jsLiteral(source.author)});
        });
        if (candidates.length !== 1) return JSON.stringify({ok:false,count:candidates.length});
        candidates[0].click();
        return JSON.stringify({ok:true});
      })()`)) as { ok: boolean; count?: number };
      if (!clicked.ok) {
        throw new Error(`Expected one exact Printables remix-source suggestion for ${source.url}, found ${clicked.count}`);
      }

      const selectedDeadline = Date.now() + 12_000;
      let selected = false;
      while (Date.now() < selectedDeadline && !selected) {
        const selection = JSON.parse(await this.javascript(windowId, tabIndex, `(() => {
          const expected = new URL(${jsLiteral(source.url)});
          const modelMatch = expected.hostname === 'www.printables.com'
            ? expected.pathname.match(/^\\/model\\/(\\d+)/)
            : null;
          const links = [...document.querySelectorAll('a[href]')].map(anchor => new URL(anchor.href));
          const found = links.some(link => modelMatch
            ? link.hostname === expected.hostname && link.pathname.startsWith('/model/' + modelMatch[1])
            : link.hostname === expected.hostname && link.pathname.replace(/\\/$/, '') === expected.pathname.replace(/\\/$/, ''));
          const input = document.querySelector(${jsLiteral(selector)});
          return JSON.stringify({found, cleared:!input?.value});
        })()`)) as { found: boolean; cleared: boolean };
        selected = selection.found && selection.cleared;
        if (!selected) await delay(350);
      }
      if (!selected) throw new Error(`Printables did not select remix source: ${source.url}`);
    }
  }

  private async setRichText(
    windowId: number,
    tabIndex: number,
    selector: string,
    value: string,
    label: string,
  ): Promise<void> {
    const result = JSON.parse(await this.javascript(windowId, tabIndex, `(() => {
      const editor = document.querySelector(${jsLiteral(selector)});
      if (!editor) return JSON.stringify({ok:false});
      editor.focus();
      document.execCommand('selectAll', false);
      const inserted = document.execCommand('insertText', false, ${jsLiteral(value)});
      editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:null}));
      return JSON.stringify({ok:inserted, text:editor.innerText || ''});
    })()`)) as { ok: boolean; text?: string };
    if (!result.ok || !result.text?.replace(/\s+/g, ' ').includes(value.replace(/\s+/g, ' ').slice(0, 80))) {
      throw new Error(`Printables ${label} entry failed`);
    }
  }

  private async uploadFiles(
    windowId: number,
    tabIndex: number,
    inputSelector: string,
    filePaths: string[],
  ): Promise<string[]> {
    const uploadDir = await mkdtemp(path.join(tmpdir(), 'printables-upload-'));
    try {
      for (const filePath of filePaths) await copyFile(filePath, path.join(uploadDir, path.basename(filePath)));
      const expectedNames = filePaths.map(filePath => path.basename(filePath));
      const inputId = JSON.parse(await this.javascript(windowId, tabIndex, `JSON.stringify({
        id:document.querySelector(${jsLiteral(inputSelector)})?.id || ''
      })`)) as { id: string };
      if (!inputId.id) throw new Error('Printables file input is unavailable');
      const coordinate = await this.focusAndCoordinate(windowId, tabIndex, `label[for="${inputId.id}"]`);
      if (coordinate.text.toLowerCase() !== 'browse') throw new Error('Printables Browse label text changed');
      await execFileAsync('/opt/homebrew/bin/cliclick', [`c:${coordinate.x},${coordinate.y}`], { timeout: 10_000 });
      await delay(1_000);
      const opened = await this.runAppleScript(`
tell application "System Events"
  ${SAFARI_FOCUS_GUARD}
  tell process "Safari"
    if (count of sheets of front window) is 0 then error "Printables file picker did not open"
    keystroke "g" using {command down, shift down}
    delay 0.5
    ${SAFARI_FOCUS_GUARD}
    keystroke "${appleScriptString(uploadDir)}"
    delay 0.3
    key code 36
    delay 1
    ${SAFARI_FOCUS_GUARD}
    keystroke "a" using {command down}
    delay 0.3
    key code 36
  end tell
end tell
return "opened"`, 45_000);
      if (opened !== 'opened') throw new Error('Safari did not open the Printables file picker');

      const deadline = Date.now() + 240_000;
      let lastState = '';
      const expectedModelStems = filePaths
        .filter(filePath => !/\.(png|jpe?g|webp)$/i.test(filePath))
        .map(filePath => path.basename(filePath, path.extname(filePath)));
      const expectedPhotos = filePaths.filter(filePath => /\.(png|jpe?g|webp)$/i.test(filePath)).length;
      while (Date.now() < deadline) {
        await delay(1_000);
        const output = await this.javascript(windowId, tabIndex, `(() => {
          const normalize = value => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          const archiveChoice = [...document.querySelectorAll('button')].find(b =>
            b.getClientRects().length && normalize(b.textContent) === 'add to other files'
          );
          if (archiveChoice) archiveChoice.click();
          const text = document.body?.innerText || '';
          const photoCount = [...document.querySelectorAll('img')]
            .filter(img => (img.src || '').includes('media.printables.com/media/prints/')).length;
          const modelFilesPresent = ${jsLiteral(expectedModelStems)}.every(stem => [...document.querySelectorAll('input')]
            .some(input => input.type === 'text' && input.value === stem));
          const disabled = [...document.querySelectorAll('button')].find(b => normalize(b.textContent) === 'save draft')?.disabled || false;
          return JSON.stringify({text, photoCount, modelFilesPresent, disabled, archiveChoice:Boolean(archiveChoice)});
        })()`);
        const state = JSON.parse(output) as {
          text: string; photoCount: number; modelFilesPresent: boolean; disabled: boolean; archiveChoice: boolean;
        };
        lastState = state.text;
        const busy = state.text.split('\n').some(line => /^(uploading|processing)\b/i.test(line.trim()));
        if (state.modelFilesPresent && state.photoCount >= expectedPhotos && !busy && !state.disabled) return expectedNames;
      }
      throw new Error(`Printables upload did not finish for ${expectedNames.length} files: ${lastState.slice(-600)}`);
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
    }
  }

  async status(): Promise<Record<string, unknown>> {
    const contract = await this.contract();
    if (!contract.createUrl) return { available: false, selectorContract: contract.status };
    try {
      return await this.withTarget(contract.createUrl, async target => {
        const output = await this.runTargeted(target.windowId, target.tabIndex, 'return (URL of agentTab) & "||" & (name of agentTab)');
        const [url, title] = output.split('||');
        return { available: true, windowId: target.windowId, url, title, selectorContract: contract.status };
      });
    } catch (error) {
      return { available: false, error: String(error), selectorContract: contract.status };
    }
  }

  async inspect(): Promise<Record<string, unknown>> {
    const contract = await this.contract();
    if (!contract.createUrl) throw new Error('Printables selector contract has no create URL');
    return this.withTarget(contract.createUrl, async target => {
      const script = `(() => {
  const inputs = [...document.querySelectorAll('input,textarea,select,button,[contenteditable="true"]')].map((el, index) => ({
    index, tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), name: el.getAttribute('name'),
    id: el.id || null, ariaLabel: el.getAttribute('aria-label'), placeholder: el.getAttribute('placeholder'),
    text: (el.innerText || '').trim().slice(0, 120)
  }));
  return JSON.stringify({ url: location.href, title: document.title, inputs });
})()`;
      return JSON.parse(await this.javascript(target.windowId, target.tabIndex, script)) as Record<string, unknown>;
    });
  }

  async prepareDraft(job: PublishJob): Promise<{ draftUrl: string }> {
    if (!job.release) throw new Error('Job has no validated release');
    const release = job.release;
    const contract = await this.contract();
    this.requireContract(contract);
    const selectors = contract.selectors as Record<string, string>;
    const isRemix = release.modelOrigin === 'Remix of another model';
    const originIndex = isRemix ? 1 : 0;

    return this.withTarget(contract.createUrl!, async target => {
      const existing = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const expectedModelStems = ${jsLiteral(release.files.map(file => path.basename(file.absolutePath, path.extname(file.absolutePath))))};
        return JSON.stringify({
          url:location.href,
          title:document.querySelector(${jsLiteral(selectors.title)})?.value || '',
          modelFilesPresent:expectedModelStems.every(stem => [...document.querySelectorAll('input')]
            .some(input => input.type === 'text' && input.value === stem))
        });
      })()`)) as { url: string; title: string; modelFilesPresent: boolean };
      if (existing.url.startsWith(contract.createUrl!) && existing.title.trim() && existing.title !== release.title) {
        throw new Error('Safari automation tab contains an unsaved Printables form; refusing to overwrite it');
      }
      // Only an interrupted upload may skip entry. A same-title form that stopped
      // before its files were attached is refilled in place from the release.
      const resumeExisting = existing.url.startsWith(contract.createUrl!)
        && existing.title === release.title && existing.modelFilesPresent;
      if (!existing.url.startsWith(contract.createUrl!)) {
        await this.runTargeted(target.windowId, target.tabIndex, `set URL of agentTab to "${appleScriptString(contract.createUrl!)}"`);
      }
      await this.waitForForm(target.windowId, target.tabIndex, selectors.title);

      let uploadedNames = [
        ...release.files.map(file => path.basename(file.absolutePath)),
        ...release.previews.map(file => path.basename(file.absolutePath)),
      ];
      if (!resumeExisting) {
      const filled = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const setValue = (selector, value) => {
          const element = document.querySelector(selector);
          if (!element) return false;
          const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
          element.dispatchEvent(new Event('input', {bubbles:true}));
          element.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        };
        const title = setValue(${jsLiteral(selectors.title)}, ${jsLiteral(release.title)});
        const summary = setValue(${jsLiteral(selectors.summary)}, ${jsLiteral(release.summary)});
        const origin = document.querySelectorAll(${jsLiteral(selectors.authorshipOriginal)})[${originIndex}];
        const ai = document.querySelectorAll(${jsLiteral(selectors.aiUsed)})[${release.aiUsed ? 0 : 1}];
        if (origin) origin.click();
        if (ai) ai.click();
        return JSON.stringify({title, summary, origin:Boolean(origin?.checked), ai:Boolean(ai?.checked)});
      })()`)) as Record<string, boolean>;
      if (!Object.values(filled).every(Boolean)) throw new Error(`Printables metadata entry failed: ${JSON.stringify(filled)}`);

      if (isRemix) {
        await this.enterRemixSources(target.windowId, target.tabIndex, selectors.remixSource, release.remixSources);
        await this.setRichText(
          target.windowId, target.tabIndex, selectors.remixDifferences, release.remixDifferences, 'remix differences',
        );
      }
      await this.setRichText(target.windowId, target.tabIndex, selectors.description, release.description, 'description');

      await this.enterTags(target.windowId, target.tabIndex, selectors.tags, release.tags);

      await this.selectExactOption(target.windowId, target.tabIndex, selectors.category, release.category);
      await this.selectExactOption(target.windowId, target.tabIndex, selectors.license, release.license);

      const uploadPaths = [
        ...release.files.map(file => file.absolutePath),
        ...release.previews.map(file => file.absolutePath),
      ];
      uploadedNames = await this.uploadFiles(target.windowId, target.tabIndex, selectors.fileInput, uploadPaths);
      }

      const preflight = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
        const title = document.querySelector(${jsLiteral(selectors.title)})?.value || '';
        const summary = document.querySelector(${jsLiteral(selectors.summary)})?.value || '';
        const category = normalize(document.querySelector(${jsLiteral(selectors.category)})?.textContent);
        const license = normalize(document.querySelector(${jsLiteral(selectors.license)})?.textContent);
        const description = document.querySelector(${jsLiteral(selectors.description)})?.innerText || '';
        const tagText = document.querySelector(${jsLiteral(selectors.tags)})?.parentElement?.innerText || '';
        const origin = Boolean(document.querySelectorAll(${jsLiteral(selectors.authorshipOriginal)})[${originIndex}]?.checked);
        const ai = Boolean(document.querySelectorAll(${jsLiteral(selectors.aiUsed)})[${release.aiUsed ? 0 : 1}]?.checked);
        const remixDifferences = document.querySelector(${jsLiteral(selectors.remixDifferences)})?.innerText || '';
        const remixSourcesPresent = ${jsLiteral(release.remixSources.map(source => source.url))}.every(sourceUrl => {
          const expected = new URL(sourceUrl);
          const modelMatch = expected.hostname === 'www.printables.com' ? expected.pathname.match(/^\\/model\\/(\\d+)/) : null;
          return [...document.querySelectorAll('a[href]')].some(anchor => {
            const link = new URL(anchor.href);
            return modelMatch
              ? link.hostname === expected.hostname && link.pathname.startsWith('/model/' + modelMatch[1])
              : link.hostname === expected.hostname && link.pathname.replace(/\\/$/, '') === expected.pathname.replace(/\\/$/, '');
          });
        });
        const publish = document.querySelector(${jsLiteral(selectors.publish || '#publish-state')});
        const saves = [...document.querySelectorAll(${jsLiteral(selectors.saveDraft)})].filter(el =>
          el.getClientRects().length && normalize(el.textContent).toLowerCase() === 'save draft'
        );
        const expectedModelStems = ${jsLiteral(release.files.map(file => path.basename(file.absolutePath, path.extname(file.absolutePath))))};
        const modelFilesPresent = expectedModelStems.every(stem => [...document.querySelectorAll('input')]
          .some(input => input.type === 'text' && input.value === stem));
        const photoCount = [...document.querySelectorAll('img')]
          .filter(img => (img.src || '').includes('media.printables.com/media/prints/')).length;
        return JSON.stringify({title, summary, category, license, description, tagText, remixDifferences, remixSourcesPresent,
          modelFilesPresent, photoCount, origin, ai,
          publishChecked:Boolean(publish?.checked), saveCount:saves.length, saveDisabled:Boolean(saves[0]?.disabled)});
      })()`)) as {
        title: string; summary: string; category: string; license: string; description: string; tagText: string;
        remixDifferences: string; remixSourcesPresent: boolean;
        modelFilesPresent: boolean; photoCount: number;
        origin: boolean; ai: boolean; publishChecked: boolean; saveCount: number; saveDisabled: boolean;
      };
      const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
      const failures = [
        preflight.title !== release.title && 'title',
        preflight.summary !== release.summary && 'summary',
        normalized(preflight.category) !== normalized(release.category) && 'category',
        normalized(preflight.license) !== normalized(release.license) && 'license',
        !normalized(preflight.description).includes(normalized(release.description.slice(0, 100))) && 'description',
        isRemix && !normalized(preflight.remixDifferences).includes(normalized(release.remixDifferences.slice(0, 100))) && 'remix-differences',
        isRemix && !preflight.remixSourcesPresent && 'remix-sources',
        !release.tags.every(tag => preflight.tagText.includes(tag)) && 'tags',
        !preflight.modelFilesPresent && 'model-files', preflight.photoCount < release.previews.length && 'previews',
        !preflight.origin && 'origin', !preflight.ai && 'ai', preflight.publishChecked && 'publish-state',
        preflight.saveCount !== 1 && 'save-control', preflight.saveDisabled && 'save-disabled',
      ].filter(Boolean);
      if (failures.length) throw new Error(`Printables draft preflight failed: ${failures.join(', ')}`);

      const clickResult = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const normalize = value => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const matches = [...document.querySelectorAll(${jsLiteral(selectors.saveDraft)})]
          .filter(el => el.getClientRects().length && normalize(el.textContent) === 'save draft');
        if (matches.length !== 1 || matches[0].disabled) return JSON.stringify({ok:false,count:matches.length,disabled:Boolean(matches[0]?.disabled)});
        matches[0].click();
        return JSON.stringify({ok:true});
      })()`)) as { ok: boolean; count?: number; disabled?: boolean };
      if (!clickResult.ok) throw new Error(`Could not activate the unique Save draft control: ${JSON.stringify(clickResult)}`);

      const deadline = Date.now() + 90_000;
      let lastUrl = contract.createUrl!;
      let lastText = '';
      while (Date.now() < deadline) {
        await delay(1_000);
        const state = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `JSON.stringify({
          url: location.href, text: document.body?.innerText || '', title: document.title,
          modelTitle:document.querySelector(${jsLiteral(selectors.title)})?.value || '',
          modelFilesPresent:${jsLiteral(release.files.map(file => path.basename(file.absolutePath, path.extname(file.absolutePath))))}
            .every(stem => [...document.querySelectorAll('input')]
              .some(input => input.type === 'text' && input.value === stem)),
          photoCount:[...document.querySelectorAll('img')]
            .filter(img => (img.src || '').includes('media.printables.com/media/prints/')).length
        })`)) as { url: string; text: string; title: string; modelTitle: string; modelFilesPresent: boolean; photoCount: number };
        lastUrl = state.url;
        lastText = state.text;
        if (/^https:\/\/www\.printables\.com\/model\/\d+/.test(state.url) && !state.url.includes('/create')) {
          if (state.modelTitle !== release.title) throw new Error('Saved Printables draft read-back is missing the release title');
          if (!/draft/i.test(state.text)) throw new Error('Saved Printables model did not read back as a draft');
          if (!state.modelFilesPresent) throw new Error(`Saved Printables draft read-back is missing model-file evidence: ${uploadedNames.join(', ')}`);
          if (state.photoCount < release.previews.length) throw new Error('Saved Printables draft read-back is missing preview images');
          return { draftUrl: state.url };
        }
      }
      const errors = lastText.split('\n').filter(line => /required|error|failed|invalid/i.test(line)).slice(0, 8);
      throw new Error(`Printables did not return a saved draft URL (last URL ${lastUrl}; ${errors.join(' | ')})`);
    });
  }

  async publish(job: PublishJob): Promise<{ publishedUrl: string }> {
    const contract = await this.contract();
    this.requireContract(contract, true);
    if (!job.release) throw new Error('Job has no validated release');
    if (!job.printablesDraftUrl) throw new Error('Job has no verified Printables draft URL');
    const release = job.release;
    const selectors = contract.selectors as Record<string, string>;
    const isRemix = release.modelOrigin === 'Remix of another model';
    const originIndex = isRemix ? 1 : 0;
    const editUrl = new URL(job.printablesDraftUrl);
    if (editUrl.hostname !== contract.host || !/^\/model\/\d+\/edit$/.test(editUrl.pathname)) {
      throw new Error('Verified Printables draft URL is outside the expected model editor');
    }
    const publicUrl = `${editUrl.origin}${editUrl.pathname.replace(/\/edit$/, '')}`;

    return this.withModelTarget(editUrl.href, async target => {
      await this.waitForModelForm(target.windowId, target.tabIndex, editUrl.href, selectors.title);
      // Several select widgets hydrate just after the title input becomes available.
      // Give their selected labels a short settling window before the exact read-back.
      await delay(1_500);
      const preflight = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
        const title = document.querySelector(${jsLiteral(selectors.title)})?.value || '';
        const summary = document.querySelector(${jsLiteral(selectors.summary)})?.value || '';
        const category = normalize(document.querySelector(${jsLiteral(selectors.category)})?.textContent);
        const license = normalize(document.querySelector(${jsLiteral(selectors.license)})?.textContent);
        const description = document.querySelector(${jsLiteral(selectors.description)})?.innerText || '';
        const tagText = document.querySelector(${jsLiteral(selectors.tags)})?.parentElement?.innerText || '';
        const origin = Boolean(document.querySelectorAll(${jsLiteral(selectors.authorshipOriginal)})[${originIndex}]?.checked);
        const ai = Boolean(document.querySelectorAll(${jsLiteral(selectors.aiUsed)})[${release.aiUsed ? 0 : 1}]?.checked);
        const remixDifferences = document.querySelector(${jsLiteral(selectors.remixDifferences)})?.innerText || '';
        const remixSourcesPresent = ${jsLiteral(release.remixSources.map(source => source.url))}.every(sourceUrl => {
          const expected = new URL(sourceUrl);
          const modelMatch = expected.hostname === 'www.printables.com' ? expected.pathname.match(/^\\/model\\/(\\d+)/) : null;
          return [...document.querySelectorAll('a[href]')].some(anchor => {
            const link = new URL(anchor.href);
            return modelMatch
              ? link.hostname === expected.hostname && link.pathname.startsWith('/model/' + modelMatch[1])
              : link.hostname === expected.hostname && link.pathname.replace(/\\/$/, '') === expected.pathname.replace(/\\/$/, '');
          });
        });
        const publish = document.querySelector(${jsLiteral(selectors.publish)});
        const modelFilesPresent = ${jsLiteral(release.files.map(file => path.basename(file.absolutePath, path.extname(file.absolutePath))))}
          .every(stem => [...document.querySelectorAll('input')]
            .some(input => input.type === 'text' && input.value === stem));
        const photoCount = [...document.querySelectorAll('img')]
          .filter(img => (img.src || '').includes('media.printables.com/media/prints/')).length;
        const primary = [...document.querySelectorAll('button')].filter(button =>
          button.getClientRects().length && button.classList.contains('btn-primary') && button.classList.contains('btn-bold')
        );
        return JSON.stringify({title, summary, category, license, description, tagText, remixDifferences, remixSourcesPresent,
          origin, ai,
          publishChecked:Boolean(publish?.checked), publishDisabled:Boolean(publish?.disabled),
          modelFilesPresent, photoCount, primaryCount:primary.length, primaryDisabled:Boolean(primary[0]?.disabled)});
      })()`)) as {
        title: string; summary: string; category: string; license: string; description: string; tagText: string;
        remixDifferences: string; remixSourcesPresent: boolean;
        origin: boolean; ai: boolean; publishChecked: boolean; publishDisabled: boolean;
        modelFilesPresent: boolean; photoCount: number; primaryCount: number; primaryDisabled: boolean;
      };
      const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
      const expectedModelNames = release.files.map(file => path.basename(file.absolutePath, path.extname(file.absolutePath)));
      const modelFilesPresent = preflight.modelFilesPresent
        || await this.verifyPersistedModelFiles(target.windowId, `${publicUrl}/files`, expectedModelNames);
      const failures = [
        preflight.title !== release.title && 'title',
        preflight.summary !== release.summary && 'summary',
        normalized(preflight.category) !== normalized(release.category) && 'category',
        normalized(preflight.license) !== normalized(release.license) && 'license',
        !normalized(preflight.description).includes(normalized(release.description.slice(0, 100))) && 'description',
        isRemix && !normalized(preflight.remixDifferences).includes(normalized(release.remixDifferences.slice(0, 100))) && 'remix-differences',
        isRemix && !preflight.remixSourcesPresent && 'remix-sources',
        !release.tags.every(tag => preflight.tagText.includes(tag)) && 'tags',
        !preflight.origin && 'origin', !preflight.ai && 'ai',
        preflight.publishChecked && 'already-published', preflight.publishDisabled && 'publish-disabled',
        !modelFilesPresent && 'model-files', preflight.photoCount < release.previews.length && 'previews',
        preflight.primaryCount !== 1 && 'primary-submit', preflight.primaryDisabled && 'submit-disabled',
      ].filter(Boolean);
      if (failures.length) throw new Error(`Printables publication preflight failed: ${failures.join(', ')}`);

      const armed = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const publish = document.querySelector(${jsLiteral(selectors.publish)});
        const switchRoot = publish?.closest('.publish-switch');
        const published = [...(switchRoot?.querySelectorAll('button') || [])]
          .find(button => (button.textContent || '').trim().toLowerCase() === 'published');
        if (!publish || publish.disabled || publish.checked || !published) {
          return JSON.stringify({ok:false,checked:Boolean(publish?.checked),found:Boolean(published)});
        }
        published.click();
        return JSON.stringify({ok:true,checked:Boolean(publish.checked),found:true});
      })()`)) as { ok: boolean; checked: boolean; found: boolean };
      if (!armed.ok || !armed.found) throw new Error('Printables public-state control did not arm');
      await delay(1_000);

      const armedState = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const publish = document.querySelector(${jsLiteral(selectors.publish)});
        const switchRoot = publish?.closest('.publish-switch');
        const published = [...(switchRoot?.querySelectorAll('button') || [])]
          .find(button => (button.textContent || '').trim().toLowerCase() === 'published');
        const primary = [...document.querySelectorAll('button')].filter(button =>
          button.getClientRects().length && button.classList.contains('btn-primary') && button.classList.contains('btn-bold')
        );
        const text = (primary[0]?.innerText || '').replace(/\\s+/g, ' ').trim();
        return JSON.stringify({checked:Boolean(publish?.checked),selected:Boolean(published?.classList.contains('selected')),
          count:primary.length,disabled:Boolean(primary[0]?.disabled),text});
      })()`)) as { checked: boolean; selected: boolean; count: number; disabled: boolean; text: string };
      if (!armedState.checked || !armedState.selected || armedState.count !== 1 || armedState.disabled
        || armedState.text.toUpperCase() !== 'PUBLISH NOW') {
        throw new Error(`Printables public-state control did not settle: ${JSON.stringify(armedState)}`);
      }

      const submission = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `(() => {
        const publish = document.querySelector(${jsLiteral(selectors.publish)});
        const primary = [...document.querySelectorAll('button')].filter(button =>
          button.getClientRects().length && button.classList.contains('btn-primary') && button.classList.contains('btn-bold')
        );
        const text = (primary[0]?.innerText || '').replace(/\\s+/g, ' ').trim();
        if (!publish?.checked || primary.length !== 1 || primary[0].disabled || text.toUpperCase() !== 'PUBLISH NOW') {
          return JSON.stringify({ok:false,count:primary.length,disabled:Boolean(primary[0]?.disabled),text});
        }
        primary[0].click();
        return JSON.stringify({ok:true,text});
      })()`)) as { ok: boolean; count?: number; disabled?: boolean; text: string };
      if (!submission.ok) throw new Error(`Could not activate the unique Printables publish submission: ${JSON.stringify(submission)}`);

      const saveDeadline = Date.now() + 90_000;
      const submittedAt = Date.now();
      let sawBusy = false;
      let saved = false;
      let lastText = '';
      while (Date.now() < saveDeadline) {
        await delay(1_000);
        const state = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `JSON.stringify({
          url:location.href,
          text:document.body?.innerText || '',
          publishChecked:Boolean(document.querySelector(${jsLiteral(selectors.publish)})?.checked),
          busy:[...document.querySelectorAll('button')].some(button =>
            button.classList.contains('btn-primary') && button.classList.contains('btn-bold') && button.disabled)
        })`)) as { url: string; text: string; publishChecked: boolean; busy: boolean };
        lastText = state.text;
        sawBusy ||= state.busy;
        const validationError = state.text.split('\n').some(line => /^(required|error|failed|invalid)\b/i.test(line.trim()));
        if (validationError) throw new Error('Printables rejected the publication form');
        if (!state.busy && (state.publishChecked || !state.url.endsWith('/edit'))
          && (sawBusy || Date.now() - submittedAt >= 5_000)) {
          saved = true;
          break;
        }
      }
      if (!saved) throw new Error('Timed out waiting for Printables to save the public state');

      await this.runTargeted(target.windowId, target.tabIndex, `set URL of agentTab to "${appleScriptString(publicUrl)}"`);
      const publicDeadline = Date.now() + 90_000;
      let lastUrl = publicUrl;
      while (Date.now() < publicDeadline) {
        await delay(1_000);
        const state = JSON.parse(await this.javascript(target.windowId, target.tabIndex, `JSON.stringify({
          url:location.href,
          ready:document.readyState,
          text:document.body?.innerText || '',
          heading:document.querySelector('h1')?.innerText || ''
        })`)) as { url: string; ready: string; text: string; heading: string };
        lastUrl = state.url;
        lastText = state.text;
        if (state.ready === 'complete' && state.url.startsWith(publicUrl)
          && normalized(state.heading) === normalized(release.title)
          && /download/i.test(state.text)
          && !/(^|\n)\s*DRAFT\s*(\n|$)/i.test(state.text)) {
          return { publishedUrl: state.url };
        }
      }
      const errors = lastText.split('\n').filter(line => /required|error|failed|invalid|not found/i.test(line)).slice(0, 8);
      throw new Error(`Printables publication did not read back as public (last URL ${lastUrl}; ${errors.join(' | ')})`);
    });
  }
}
