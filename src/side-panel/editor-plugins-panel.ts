import { css, html, LitElement, nothing, TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';
import { localized, msg } from '@lit/localize';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { styleMap } from 'lit/directives/style-map.js';
import { createRef, ref } from 'lit/directives/ref.js';

import { OscdIcon } from '@omicronenergy/oscd-ui/icon/OscdIcon.js';
import { OscdIconButton } from '@omicronenergy/oscd-ui/iconbutton/OscdIconButton.js';

import { LocaleTag, Translation } from '../localization.js';
import {
  EditorPluginEntry,
  PluginEntry,
  ResolvedPluginGroup,
} from '../oscd-shell.js';
import { isPluginGroup } from '../utils/plugin-utils.js';

declare global {
  interface HTMLElementTagNameMap {
    'editor-plugins-panel': EditorPluginsPanel;
  }
}

function loadSet(key: string): Set<string> {
  try {
    const stored = localStorage.getItem(key);
    return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveSet(key: string, set: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

interface FlatPlugin {
  plugin: PluginEntry;
  flatIndex: number;
}

type NavigableItem =
  | { kind: 'plugin'; plugin: PluginEntry; flatIndex: number }
  | { kind: 'group'; groupName: string }
  | { kind: 'pinned' };

interface ShortcutEntry {
  key: string;
  type: 'pinned' | 'group' | 'plugin';
  flatIndex: number;
  groupName?: string;
}

const PINNED_GROUP_KEY = '__pinned__';

@localized()
export class EditorPluginsPanel extends ScopedElementsMixin(LitElement) {
  static scopedElements = {
    'oscd-icon': OscdIcon,
    'oscd-icon-button': OscdIconButton,
  };

  @property({ type: Array })
  editors: EditorPluginEntry[] = [];

  @property({ type: Number })
  editorIndex = 0;

  @property({ type: String })
  locale!: LocaleTag;

  @state()
  private pinnedPluginKeys: Set<string> = loadSet('editorsPanel.pinnedPlugins');

  // Tracks whether the active selection was made from the pinned group or elsewhere
  @state()
  private activeFromPinned: boolean = false;

  @state()
  private hoveredGroupName: string | null = null;

  @state()
  private hoveredRect: DOMRect | null = null;

  @state()
  private collapsedGroups: Set<string> = loadSet(
    'editorsPanel.collapsedGroups',
  );

  @state()
  private pinnedCollapsed: boolean =
    localStorage.getItem('editorsPanel.pinnedCollapsed') === 'true';

  @state()
  private searchQuery: string = '';

  @state()
  private showShortcuts = false;

  @state()
  private activeShortcutGroup: string | null = null;

  @state()
  private shortcutNumberBuffer = '';

  @state()
  private focusedItem: NavigableItem | null = null;

  private _shortcutConfirmTimer: ReturnType<typeof setTimeout> | null = null;

  private searchInputRef = createRef<HTMLInputElement>();

  private editorsListRef = createRef<HTMLElement>();

  private _hoverTimer: ReturnType<typeof setTimeout> | null = null;

  private isExpanded: boolean =
    localStorage.getItem('editorsPanel.expanded') !== 'false';

  @property({ type: Boolean, reflect: true })
  get expanded(): boolean {
    return this.isExpanded;
  }

  set expanded(value: boolean) {
    const old = this.isExpanded;
    this.isExpanded = value;
    localStorage.setItem('editorsPanel.expanded', value.toString());
    this.requestUpdate('expanded', old);
    this.dispatchEvent(
      new CustomEvent('panel-expanded-change', {
        detail: { expanded: value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
    if (this._shortcutConfirmTimer) {
      clearTimeout(this._shortcutConfirmTimer);
      this._shortcutConfirmTimer = null;
    }
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    this.removeEventListener('click', this.handleOutsideClick);
  }

  private resetShortcuts() {
    this.showShortcuts = false;
    this.activeShortcutGroup = null;
    this.shortcutNumberBuffer = '';
    this.focusedItem = null;
    if (this._shortcutConfirmTimer) {
      clearTimeout(this._shortcutConfirmTimer);
      this._shortcutConfirmTimer = null;
    }
    if (this._wasCollapsedForShortcut) {
      this.expanded = false;
      this._wasCollapsedForShortcut = false;
    }
  }

  private collapseAfterSearchIfNeeded() {
    if (this._wasCollapsedForSearch) {
      this._wasCollapsedForSearch = false;
      this.expanded = false;
    }
  }

  private _wasCollapsedForShortcut = false;

  private _wasCollapsedForSearch = false;

  private confirmShortcutSelection() {
    if (this.activeShortcutGroup === null || this.shortcutNumberBuffer === '') {
      this.resetShortcuts();
      return;
    }
    const num = parseInt(this.shortcutNumberBuffer, 10);
    this.shortcutNumberBuffer = '';
    if (num < 1) {
      this.resetShortcuts();
      return;
    }
    const entry = this.shortcutMap.find(
      s => s.key === this.activeShortcutGroup,
    );
    if (entry) {
      if (entry.type === 'pinned') {
        const pinned = this.pinnedPluginsList;
        if (num - 1 < pinned.length) {
          this.selectEditor(
            pinned[num - 1].plugin,
            pinned[num - 1].flatIndex,
            true,
          );
        }
      } else if (entry.type === 'group' && entry.groupName) {
        const groupPlugins = this.getGroupFlatPlugins(entry.groupName);
        if (num - 1 < groupPlugins.length) {
          this.selectEditor(
            groupPlugins[num - 1].plugin,
            groupPlugins[num - 1].flatIndex,
            false,
          );
        }
      }
    }
    this.resetShortcuts();
  }

  private navigatePlugins(direction: 'ArrowDown' | 'ArrowUp') {
    const items = this.visibleNavigableItems;
    if (items.length === 0) {
      return;
    }
    if (this.focusedItem === null) {
      this.focusedItem =
        direction === 'ArrowDown' ? items[0] : items[items.length - 1];
    } else {
      const currentPos = items.findIndex(item =>
        this.navigableItemsEqual(item, this.focusedItem),
      );
      const nextPos =
        direction === 'ArrowDown'
          ? (currentPos + 1) % items.length
          : (currentPos - 1 + items.length) % items.length;
      this.focusedItem = items[nextPos >= 0 ? nextPos : 0];
    }
    this.scrollFocusedIntoView();
  }

  private confirmFocusedItem() {
    if (this.focusedItem === null) {
      return;
    }
    if (this.focusedItem.kind === 'plugin') {
      this.selectEditor(
        this.focusedItem.plugin,
        this.focusedItem.flatIndex,
        false,
      );
    } else if (this.focusedItem.kind === 'group') {
      if (this.collapsedGroups.has(this.focusedItem.groupName)) {
        const groupPlugins = this.getGroupFlatPlugins(
          this.focusedItem.groupName,
        );
        this.toggleGroupCollapse(this.focusedItem.groupName);
        if (groupPlugins.length > 0) {
          this.focusedItem = {
            kind: 'plugin',
            plugin: groupPlugins[0].plugin,
            flatIndex: groupPlugins[0].flatIndex,
          };
          return;
        }
      }
    } else if (this.focusedItem.kind === 'pinned') {
      this.pinnedCollapsed = false;
      localStorage.setItem(
        'editorsPanel.pinnedCollapsed',
        this.pinnedCollapsed.toString(),
      );
      const pinnedPlugins = this.pinnedPluginsList;
      if (pinnedPlugins.length > 0) {
        this.focusedItem = {
          kind: 'plugin',
          plugin: pinnedPlugins[0].plugin,
          flatIndex: pinnedPlugins[0].flatIndex,
        };
        return;
      }
    }
    this.focusedItem = null;
  }

  // eslint-disable-next-line class-methods-use-this
  private navigableItemsEqual(
    a: NavigableItem | null,
    b: NavigableItem | null,
  ): boolean {
    if (a === null || b === null) {
      return a === b;
    }
    if (a.kind !== b.kind) {
      return false;
    }
    if (a.kind === 'plugin' && b.kind === 'plugin') {
      return a.flatIndex === b.flatIndex;
    }
    if (a.kind === 'group' && b.kind === 'group') {
      return a.groupName === b.groupName;
    }
    return a.kind === 'pinned' && b.kind === 'pinned';
  }

  private handleEditorListKeyDown(e: KeyboardEvent) {
    const items = this.visibleNavigableItems;
    if (items.length === 0) {
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.navigatePlugins(e.key);
      return;
    }

    if ((e.key === 'Enter' || e.key === ' ') && this.focusedItem !== null) {
      e.preventDefault();
      this.confirmFocusedItem();
      return;
    }

    if (e.key === 'Escape') {
      this.focusedItem = null;
    }
  }

  private scrollFocusedIntoView() {
    if (this.focusedItem === null) {
      return;
    }
    requestAnimationFrame(() => {
      const sel =
        this.focusedItem!.kind === 'plugin'
          ? `.plugin-item[data-flat-index="${this.focusedItem!.flatIndex}"]`
          : this.focusedItem!.kind === 'group'
            ? `.group-header[data-group-name="${this.focusedItem!.groupName}"]`
            : '.group-header[data-group-name="__pinned__"]';
      const el = this.renderRoot?.querySelector(sel);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  private handleKeyDown = async (e: KeyboardEvent) => {
    // Don't capture shortcuts while typing in the search input
    if (
      (e.target as HTMLElement)?.tagName === 'INPUT' ||
      (e.target as HTMLElement)?.tagName === 'TEXTAREA'
    ) {
      return;
    }

    // Ctrl held down → show all shortcut badges
    if (e.key === 'Control') {
      this.showShortcuts = true;
      this.activeShortcutGroup = null;
      this.shortcutNumberBuffer = '';
      return;
    }

    // If a group is selected, listen for digit keys without requiring Ctrl
    if (this.activeShortcutGroup !== null) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.resetShortcuts();
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        // Leading zero is not valid
        if (this.shortcutNumberBuffer === '' && e.key === '0') {
          return;
        }
        this.shortcutNumberBuffer += e.key;
        // Restart the confirmation timer
        if (this._shortcutConfirmTimer) {
          clearTimeout(this._shortcutConfirmTimer);
        }
        // Auto-confirm after 600ms of no further digits
        this._shortcutConfirmTimer = setTimeout(() => {
          this.confirmShortcutSelection();
        }, 600);
        return;
      }
      // Enter confirms the current number
      if (e.key === 'Enter' && this.shortcutNumberBuffer !== '') {
        e.preventDefault();
        this.confirmShortcutSelection();
        return;
      }
      // Any other key cancels
      e.preventDefault();
      this.resetShortcuts();
      return;
    }

    if (!e.ctrlKey && !e.metaKey) {
      return;
    }

    // Ctrl+F → focus search (expand sidebar if needed)
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      this.showShortcuts = true;
      if (!this.expanded) {
        this._wasCollapsedForSearch = true;
        this.expanded = true;
      }
      if (!this.expanded || this._wasCollapsedForSearch) {
        await this.updateComplete;
      }
      (this.searchInputRef.value as HTMLInputElement | undefined)?.focus();
      return;
    }

    // Ctrl+letter → select group or ungrouped plugin
    const letter = e.key.toUpperCase();
    if (letter.length === 1 && letter >= 'A' && letter <= 'Z') {
      e.preventDefault();
      const entry = this.shortcutMap.find(s => s.key === letter);
      if (entry) {
        if (entry.type === 'plugin') {
          this.selectEditor(
            (this.editors[entry.flatIndex] as PluginEntry) ??
              this.allFlatPlugins.find(f => f.flatIndex === entry.flatIndex)
                ?.plugin ??
              ({ name: '', tagName: '' } as PluginEntry),
            entry.flatIndex,
            false,
          );
          this.resetShortcuts();
        } else {
          // Group or pinned: enter number-input mode
          this.activeShortcutGroup = letter;
          this.shortcutNumberBuffer = '';
          this.showShortcuts = true;
          // Expand sidebar if collapsed so user can see plugin numbers
          if (!this.expanded) {
            this._wasCollapsedForShortcut = true;
            this.expanded = true;
          }
          // Release Ctrl doesn't dismiss — we're in number-input mode now
        }
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    // Only dismiss on Ctrl release if we're NOT in number-input mode
    if (e.key === 'Control' && this.activeShortcutGroup === null) {
      this.resetShortcuts();
    }
  };

  private handleOutsideClick = () => {
    if (this.activeShortcutGroup !== null || this.showShortcuts) {
      this.resetShortcuts();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
    this.addEventListener('click', this.handleOutsideClick);
  }

  // eslint-disable-next-line class-methods-use-this
  private pluginKey(plugin: PluginEntry): string {
    return `${plugin.name}||${plugin.tagName}`;
  }

  private get allFlatPlugins(): FlatPlugin[] {
    const result: FlatPlugin[] = [];
    let fi = 0;
    for (const item of this.editors) {
      if (isPluginGroup(item)) {
        for (const p of (item as ResolvedPluginGroup).plugins) {
          result.push({ plugin: p, flatIndex: fi++ });
        }
      } else {
        result.push({ plugin: item as PluginEntry, flatIndex: fi++ });
      }
    }
    return result;
  }

  private get pinnedPluginsList(): FlatPlugin[] {
    return this.allFlatPlugins.filter(({ plugin }) =>
      this.pinnedPluginKeys.has(this.pluginKey(plugin)),
    );
  }

  private getGroupFlatPlugins(groupName: string): FlatPlugin[] {
    let fi = 0;
    for (const e of this.editors) {
      if (isPluginGroup(e)) {
        const g = e as ResolvedPluginGroup;
        if (g.name === groupName) {
          return g.plugins.map((p, i) => ({ plugin: p, flatIndex: fi + i }));
        }
        fi += g.plugins.length;
      } else {
        fi++;
      }
    }
    return [];
  }

  private get visibleNavigableItems(): NavigableItem[] {
    if (!this.isSearching) {
      const result: NavigableItem[] = [];
      if (this.pinnedPluginsList.length > 0 && this.pinnedCollapsed) {
        result.push({ kind: 'pinned' });
      } else if (this.pinnedPluginsList.length > 0) {
        for (const { plugin, flatIndex } of this.pinnedPluginsList) {
          result.push({ kind: 'plugin', plugin, flatIndex });
        }
      }
      let fi = 0;
      for (const item of this.editors) {
        if (isPluginGroup(item)) {
          const g = item as ResolvedPluginGroup;
          if (this.collapsedGroups.has(g.name)) {
            result.push({ kind: 'group', groupName: g.name });
            fi += g.plugins.length;
          } else {
            for (const p of g.plugins) {
              result.push({ kind: 'plugin', plugin: p, flatIndex: fi++ });
            }
          }
        } else {
          result.push({
            kind: 'plugin',
            plugin: item as PluginEntry,
            flatIndex: fi++,
          });
        }
      }
      return result;
    }
    const q = this.searchQuery.trim().toLowerCase();
    const result: NavigableItem[] = [];
    let fi = 0;
    for (const item of this.editors) {
      if (isPluginGroup(item)) {
        const g = item as ResolvedPluginGroup;
        const groupMatches = EditorPluginsPanel.matchesSearch(
          this.pluginLabel(g),
          q,
        );
        if (groupMatches) {
          for (const p of g.plugins) {
            result.push({ kind: 'plugin', plugin: p, flatIndex: fi++ });
          }
        } else {
          for (const p of g.plugins) {
            if (EditorPluginsPanel.matchesSearch(this.pluginLabel(p), q)) {
              result.push({ kind: 'plugin', plugin: p, flatIndex: fi });
            }
            fi++;
          }
        }
      } else {
        const p = item as PluginEntry;
        if (EditorPluginsPanel.matchesSearch(this.pluginLabel(p), q)) {
          result.push({ kind: 'plugin', plugin: p, flatIndex: fi });
        }
        fi++;
      }
    }
    return result;
  }

  private togglePluginPin(plugin: PluginEntry) {
    const key = this.pluginKey(plugin);
    const next = new Set(this.pinnedPluginKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.pinnedPluginKeys = next;
    saveSet('editorsPanel.pinnedPlugins', next);
  }

  private toggleExpanded() {
    this.expanded = !this.expanded;
  }

  private get hasGroups(): boolean {
    return (
      this.pinnedPluginsList.length > 0 ||
      this.editors.some(item => isPluginGroup(item))
    );
  }

  private get allSectionsCollapsed(): boolean {
    const pinnedCollapsed =
      this.pinnedPluginsList.length > 0 ? this.pinnedCollapsed : true;
    const groups = this.editors.filter(isPluginGroup) as ResolvedPluginGroup[];
    const groupsCollapsed =
      groups.length > 0
        ? groups.every(g => this.collapsedGroups.has(g.name))
        : true;
    const ungroupedCount = this.editors.filter(i => !isPluginGroup(i)).length;
    return (
      pinnedCollapsed &&
      groupsCollapsed &&
      (groups.length > 0 ||
        this.pinnedPluginsList.length > 0 ||
        ungroupedCount === 0)
    );
  }

  private toggleGroupCollapse(groupName: string) {
    const next = new Set(this.collapsedGroups);
    if (next.has(groupName)) {
      next.delete(groupName);
    } else {
      next.add(groupName);
    }
    this.collapsedGroups = next;
    saveSet('editorsPanel.collapsedGroups', next);
  }

  private toggleAllGroups() {
    if (this.allSectionsCollapsed) {
      this.pinnedCollapsed = false;
      localStorage.setItem('editorsPanel.pinnedCollapsed', 'false');
      this.collapsedGroups = new Set();
      saveSet('editorsPanel.collapsedGroups', new Set());
    } else {
      this.pinnedCollapsed = true;
      localStorage.setItem('editorsPanel.pinnedCollapsed', 'true');
      const all = new Set<string>();
      for (const item of this.editors) {
        if (isPluginGroup(item)) {
          all.add((item as ResolvedPluginGroup).name);
        }
      }
      this.collapsedGroups = all;
      saveSet('editorsPanel.collapsedGroups', all);
    }
  }

  private clearSearch() {
    this.searchQuery = '';
    (this.searchInputRef.value as HTMLInputElement | undefined)?.focus();
  }

  private get shortcutMap(): ShortcutEntry[] {
    const entries: ShortcutEntry[] = [];
    let letterIndex = 0;
    const pinnedPlugins = this.pinnedPluginsList;
    if (pinnedPlugins.length > 0) {
      // Skip 'F' — reserved for search
      if (letterIndex === 5) {
        letterIndex++;
      }
      entries.push({
        key: String.fromCharCode(65 + letterIndex),
        type: 'pinned',
        flatIndex: pinnedPlugins[0].flatIndex,
        groupName: '__pinned__',
      });
      letterIndex++;
    }
    let flatIndex = 0;
    for (const item of this.editors) {
      if (isPluginGroup(item)) {
        const g = item as ResolvedPluginGroup;
        if (letterIndex < 26) {
          if (letterIndex === 5) {
            letterIndex++;
          } // Skip 'F'
          entries.push({
            key: String.fromCharCode(65 + letterIndex),
            type: 'group',
            flatIndex,
            groupName: g.name,
          });
          letterIndex++;
        }
        flatIndex += g.plugins.length;
      } else {
        if (letterIndex < 26) {
          if (letterIndex === 5) {
            letterIndex++;
          } // Skip 'F'
          entries.push({
            key: String.fromCharCode(65 + letterIndex),
            type: 'plugin',
            flatIndex,
          });
          letterIndex++;
        }
        flatIndex++;
      }
    }
    return entries;
  }

  private static renderShortcutBadge(label: string): TemplateResult {
    return html`<span class="shortcut-badge">${label}</span>`;
  }

  private static levenshteinAtMost1(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) {
      return false;
    }
    if (a === b) {
      return true;
    }
    const la = a.length;
    const lb = b.length;
    if (la === 0) {
      return lb <= 1;
    }
    if (lb === 0) {
      return la <= 1;
    }
    const row = new Array(la + 1);
    for (let i = 0; i <= la; i++) {
      row[i] = i;
    }
    for (let j = 1; j <= lb; j++) {
      let prev = row[0];
      row[0] = j;
      let rowMin = j;
      for (let i = 1; i <= la; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const val = Math.min(prev + cost, row[i] + 1, row[i - 1] + 1);
        prev = row[i];
        row[i] = val;
        if (val < rowMin) {
          rowMin = val;
        }
      }
      if (rowMin > 1) {
        return false;
      }
    }
    return row[la] <= 1;
  }

  private static matchesSearch(text: string, query: string): boolean {
    const lower = text.toLowerCase();
    if (lower.includes(query)) {
      return true;
    }
    const matchLengths = [query.length, query.length + 1];
    const tokens = lower.split(/[\s\-_/]+/);
    for (const token of tokens) {
      if (token.length === 0) {
        continue;
      }
      if (EditorPluginsPanel.levenshteinAtMost1(query, token)) {
        return true;
      }
      for (let i = 0; i <= token.length - query.length + 1; i++) {
        for (const len of matchLengths) {
          if (i + len > token.length) {
            continue;
          }
          const sub = token.substring(i, i + len);
          if (EditorPluginsPanel.levenshteinAtMost1(query, sub)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private get filteredEditors(): EditorPluginEntry[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      return this.editors;
    }
    return this.editors.filter(item => {
      if (isPluginGroup(item)) {
        const g = item as ResolvedPluginGroup;
        if (EditorPluginsPanel.matchesSearch(this.pluginLabel(g), q)) {
          return true;
        }
        return g.plugins.some(p =>
          EditorPluginsPanel.matchesSearch(this.pluginLabel(p), q),
        );
      }
      return EditorPluginsPanel.matchesSearch(
        this.pluginLabel(item as PluginEntry),
        q,
      );
    });
  }

  private get isSearching(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  private showPopup(groupName: string, el: Element) {
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
    this.hoveredGroupName = groupName;
    this.hoveredRect = el.getBoundingClientRect();
  }

  private scheduleHidePopup() {
    this._hoverTimer = setTimeout(() => {
      this.hoveredGroupName = null;
      this.hoveredRect = null;
      this._hoverTimer = null;
    }, 120);
  }

  private cancelHidePopup() {
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
  }

  private pluginLabel(plugin: PluginEntry | ResolvedPluginGroup): string {
    return plugin.translations?.[this.locale as Translation] ?? plugin.name;
  }

  private selectEditor(editor: PluginEntry, index: number, fromPinned = false) {
    this.activeFromPinned = fromPinned;
    this.searchQuery = '';
    this.focusedItem = null;
    this.collapseAfterSearchIfNeeded();
    this.dispatchEvent(
      new CustomEvent('editor-select', {
        detail: { editor, index },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // eslint-disable-next-line class-methods-use-this
  private renderPluginIcon(
    plugin: PluginEntry,
    extraClass = '',
  ): TemplateResult {
    if (plugin.icon) {
      return html`<oscd-icon class="item-icon ${extraClass}"
        >${plugin.icon}</oscd-icon
      >`;
    }
    const letter = (plugin.name || '?')[0].toUpperCase();
    return html`<span class="item-icon plugin-letter-icon ${extraClass}"
      >${letter}</span
    >`;
  }

  private renderPluginItem(
    plugin: PluginEntry,
    flatIndex: number,
    opts: {
      inGroup?: boolean;
      inPinnedGroup?: boolean;
      groupPosition?: number;
    } = {},
  ): TemplateResult {
    const isActive = this.editorIndex === flatIndex;
    const tooltip = !this.expanded ? this.pluginLabel(plugin) : undefined;
    const isPinned = this.pinnedPluginKeys.has(this.pluginKey(plugin));

    let shortcutBadge: TemplateResult | typeof nothing = nothing;
    let shortcutHighlight = false;
    if (this.activeShortcutGroup !== null) {
      // Level 2: only show badges within the selected group
      const groupEntry = this.shortcutMap.find(
        s => s.key === this.activeShortcutGroup,
      );
      if (groupEntry) {
        if (
          (groupEntry.type === 'pinned' && opts.inPinnedGroup) ||
          (groupEntry.type === 'group' && opts.inGroup && groupEntry.groupName)
        ) {
          let itemList: FlatPlugin[];
          if (groupEntry.type === 'pinned') {
            itemList = this.pinnedPluginsList;
          } else if (groupEntry.groupName) {
            itemList = this.getGroupFlatPlugins(groupEntry.groupName);
          } else {
            itemList = [];
          }
          const idx = itemList.findIndex(f => f.flatIndex === flatIndex);
          if (idx >= 0) {
            shortcutBadge = EditorPluginsPanel.renderShortcutBadge(
              String(idx + 1),
            );
            if (
              this.shortcutNumberBuffer !== '' &&
              String(idx + 1).startsWith(this.shortcutNumberBuffer)
            ) {
              shortcutHighlight = true;
            }
          }
        }
      }
    } else if (this.showShortcuts) {
      // Level 1: Ctrl held, show letters on top-level items only
      if (!opts.inGroup && !opts.inPinnedGroup) {
        const entry = this.shortcutMap.find(
          s => s.type === 'plugin' && s.flatIndex === flatIndex,
        );
        if (entry) {
          shortcutBadge = EditorPluginsPanel.renderShortcutBadge(entry.key);
        }
      }
      // Numbers inside groups are NOT shown at level 1 — only after selecting a group
    }

    const isFocused =
      this.focusedItem?.kind === 'plugin' &&
      this.focusedItem.flatIndex === flatIndex;

    return html`
      <div
        class=${classMap({
          'plugin-item': true,
          'plugin-item--active': isActive,
          'plugin-item--focused': isFocused,
          'plugin-item--in-group': !!opts.inGroup,
          'plugin-item--shortcut-target': shortcutHighlight,
        })}
        data-flat-index=${flatIndex}
        role="button"
        tabindex="0"
        title=${ifDefined(tooltip)}
        @click=${() =>
          this.selectEditor(plugin, flatIndex, !!opts.inPinnedGroup)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            this.selectEditor(plugin, flatIndex, !!opts.inPinnedGroup);
          }
        }}
      >
        <span class="shortcut-badge-container"
          >${this.renderPluginIcon(plugin)}${shortcutBadge}</span
        >
        ${this.expanded
          ? html`
              <span class="plugin-item-label">${this.pluginLabel(plugin)}</span>
              <button
                class=${classMap({
                  'plugin-pin-btn': true,
                  'plugin-pin-btn--active': isPinned,
                })}
                title=${isPinned ? msg('Unpin plugin') : msg('Pin plugin')}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.togglePluginPin(plugin);
                }}
              >
                <oscd-icon ?filled=${isPinned}>push_pin</oscd-icon>
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private renderPinnedGroup(flatPlugins: FlatPlugin[]): TemplateResult {
    // Only highlight this group when the user selected from within it
    const hasActiveChild =
      this.activeFromPinned &&
      flatPlugins.some(({ flatIndex }) => flatIndex === this.editorIndex);

    const isPinnedInShortcutGroup =
      this.activeShortcutGroup !== null &&
      this.shortcutMap.find(s => s.key === this.activeShortcutGroup)?.type ===
        'pinned';
    const isCollapsed =
      !this.isSearching && this.pinnedCollapsed && !isPinnedInShortcutGroup;
    const pinnedShortcut =
      this.showShortcuts && this.activeShortcutGroup === null
        ? this.shortcutMap.find(s => s.type === 'pinned')
        : this.activeShortcutGroup !== null
          ? this.shortcutMap.find(
              s => s.key === this.activeShortcutGroup && s.type === 'pinned',
            )
          : undefined;

    if (this.expanded) {
      return html`
        <div
          class=${classMap({
            'group-container': true,
            'group-container--inactive': !hasActiveChild,
            'group-container--collapsed': isCollapsed,
          })}
        >
          <div
            class=${classMap({
              'group-header': true,
              'group-active': hasActiveChild,
              'group-header--clickable': true,
              'group-header--focused': this.focusedItem?.kind === 'pinned',
            })}
            data-group-name="__pinned__"
            role="button"
            tabindex="0"
            @click=${() => {
              this.pinnedCollapsed = !this.pinnedCollapsed;
              localStorage.setItem(
                'editorsPanel.pinnedCollapsed',
                this.pinnedCollapsed.toString(),
              );
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this.pinnedCollapsed = !this.pinnedCollapsed;
                localStorage.setItem(
                  'editorsPanel.pinnedCollapsed',
                  this.pinnedCollapsed.toString(),
                );
              }
            }}
          >
            <span class="shortcut-badge-container"
              ><oscd-icon class="group-header-icon">push_pin</oscd-icon
              >${pinnedShortcut
                ? EditorPluginsPanel.renderShortcutBadge(pinnedShortcut.key)
                : nothing}</span
            >
            <span class="group-name">${msg('Pinned')}</span>
            <oscd-icon class="group-collapse-chevron"
              >${isCollapsed ? 'expand_more' : 'expand_less'}</oscd-icon
            >
          </div>
          ${isCollapsed
            ? nothing
            : html`
                <div class="group-divider"></div>
                ${flatPlugins.map(({ plugin, flatIndex }, i) =>
                  this.renderPluginItem(plugin, flatIndex, {
                    inGroup: true,
                    inPinnedGroup: true,
                    groupPosition: i,
                  }),
                )}
              `}
        </div>
      `;
    }

    const isHovered = this.hoveredGroupName === PINNED_GROUP_KEY;
    const activeChildIndex = hasActiveChild
      ? flatPlugins.findIndex(({ flatIndex }) => flatIndex === this.editorIndex)
      : -1;
    return html`
      <div
        class=${classMap({
          'group-container': true,
          'group-container--inactive': !hasActiveChild,
          'group-container--collapsed-active': hasActiveChild,
          'group-container--hovered': isHovered,
        })}
        @mouseenter=${(e: MouseEvent) =>
          this.showPopup(PINNED_GROUP_KEY, e.currentTarget as Element)}
        @mouseleave=${() => this.scheduleHidePopup()}
      >
        <div
          class=${classMap({
            'group-header-narrow': true,
            'group-active': hasActiveChild,
          })}
        >
          <span class="shortcut-badge-container"
            ><oscd-icon class="group-header-icon">push_pin</oscd-icon
            >${pinnedShortcut
              ? EditorPluginsPanel.renderShortcutBadge(pinnedShortcut.key)
              : nothing}</span
          >
        </div>
        ${activeChildIndex >= 0
          ? this.renderPluginItem(
              flatPlugins[activeChildIndex].plugin,
              flatPlugins[activeChildIndex].flatIndex,
              {
                inGroup: true,
                inPinnedGroup: true,
                groupPosition: activeChildIndex,
              },
            )
          : nothing}
      </div>
    `;
  }

  private renderGroup(
    group: ResolvedPluginGroup,
    flatStart: number,
    searchFilter?: string,
  ): TemplateResult {
    const label = this.pluginLabel(group);
    const hasActiveChild =
      !this.activeFromPinned &&
      group.plugins.some((_, i) => flatStart + i === this.editorIndex);

    const groupShortcut =
      this.showShortcuts && this.activeShortcutGroup === null
        ? this.shortcutMap.find(s => s.groupName === group.name)
        : this.activeShortcutGroup !== null
          ? this.shortcutMap.find(
              s =>
                s.key === this.activeShortcutGroup &&
                s.groupName === group.name,
            )
          : undefined;

    if (this.expanded) {
      const isInShortcutGroup =
        this.activeShortcutGroup !== null &&
        this.shortcutMap.find(s => s.key === this.activeShortcutGroup)
          ?.groupName === group.name;
      const isCollapsed =
        !this.isSearching &&
        this.collapsedGroups.has(group.name) &&
        !isInShortcutGroup;
      return html`
        <div
          class=${classMap({
            'group-container': true,
            'group-container--inactive': !hasActiveChild,
            'group-container--collapsed': isCollapsed,
          })}
        >
          <div
            class=${classMap({
              'group-header': true,
              'group-active': hasActiveChild,
              'group-header--clickable': true,
              'group-header--focused':
                this.focusedItem?.kind === 'group' &&
                this.focusedItem.groupName === group.name,
            })}
            data-group-name=${group.name}
            role="button"
            tabindex="0"
            @click=${() => this.toggleGroupCollapse(group.name)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this.toggleGroupCollapse(group.name);
              }
            }}
          >
            <span class="shortcut-badge-container"
              ><oscd-icon class="group-header-icon">${group.icon}</oscd-icon
              >${groupShortcut
                ? EditorPluginsPanel.renderShortcutBadge(groupShortcut.key)
                : nothing}</span
            >
            <span class="group-name">${label}</span>
            <oscd-icon class="group-collapse-chevron"
              >${isCollapsed ? 'expand_more' : 'expand_less'}</oscd-icon
            >
          </div>
          ${isCollapsed
            ? nothing
            : html`
                <div class="group-divider"></div>
                ${group.plugins
                  .filter((_, i) =>
                    searchFilter
                      ? EditorPluginsPanel.matchesSearch(
                          this.pluginLabel(group.plugins[i]),
                          searchFilter,
                        )
                      : true,
                  )
                  .map((plugin, filteredIdx) => {
                    const originalIndex = searchFilter
                      ? group.plugins.indexOf(plugin)
                      : filteredIdx;
                    return this.renderPluginItem(
                      plugin,
                      flatStart + originalIndex,
                      {
                        inGroup: true,
                        groupPosition: originalIndex,
                      },
                    );
                  })}
              `}
        </div>
      `;
    }

    // Collapsed: group icon only. Hover → popup. Click → expand sidebar.
    // When a child plugin is active, also show it below the group icon.
    const isHovered = this.hoveredGroupName === group.name;
    const activeChildIndex = hasActiveChild
      ? group.plugins.findIndex((_, i) => flatStart + i === this.editorIndex)
      : -1;
    return html`
      <div
        class=${classMap({
          'group-container': true,
          'group-container--inactive': !hasActiveChild,
          'group-container--collapsed-active': hasActiveChild,
          'group-container--hovered': isHovered,
        })}
        @mouseenter=${(e: MouseEvent) =>
          this.showPopup(group.name, e.currentTarget as Element)}
        @mouseleave=${() => this.scheduleHidePopup()}
      >
        <div
          class=${classMap({
            'group-header-narrow': true,
            'group-active': hasActiveChild,
          })}
          role="button"
          tabindex="0"
          title=${label}
          @click=${() => {
            this.expanded = true;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              this.expanded = true;
            }
          }}
        >
          <span class="shortcut-badge-container"
            ><oscd-icon class="group-header-icon">${group.icon}</oscd-icon
            >${groupShortcut
              ? EditorPluginsPanel.renderShortcutBadge(groupShortcut.key)
              : nothing}</span
          >
        </div>
        ${activeChildIndex >= 0
          ? this.renderPluginItem(
              group.plugins[activeChildIndex],
              flatStart + activeChildIndex,
              { inGroup: true, groupPosition: activeChildIndex },
            )
          : nothing}
      </div>
    `;
  }

  private renderHoverPopup(): TemplateResult | typeof nothing {
    if (this.expanded || !this.hoveredGroupName || !this.hoveredRect) {
      return nothing;
    }

    const rect = this.hoveredRect;
    let groupLabel: string;
    let groupIcon: string;
    let plugins: FlatPlugin[];

    if (this.hoveredGroupName === PINNED_GROUP_KEY) {
      groupLabel = msg('Pinned');
      groupIcon = 'push_pin';
      plugins = this.pinnedPluginsList;
    } else {
      const group = this.editors.find(
        e =>
          isPluginGroup(e) &&
          (e as ResolvedPluginGroup).name === this.hoveredGroupName,
      ) as ResolvedPluginGroup | undefined;
      if (!group) {
        return nothing;
      }
      groupLabel = this.pluginLabel(group);
      groupIcon = group.icon;
      plugins = this.getGroupFlatPlugins(group.name);
    }

    return html`
      <div
        class="hover-popup"
        style=${styleMap({ top: `${rect.top}px`, left: `${rect.right}px` })}
        @mouseenter=${() => this.cancelHidePopup()}
        @mouseleave=${() => this.scheduleHidePopup()}
      >
        <div class="hover-popup-header">
          <oscd-icon class="hover-popup-group-icon">${groupIcon}</oscd-icon>
          <span class="hover-popup-group-name">${groupLabel}</span>
        </div>
        <div class="group-divider"></div>
        ${plugins.map(({ plugin, flatIndex }) => {
          const fromPinnedPopup = this.hoveredGroupName === PINNED_GROUP_KEY;
          const isActive = this.editorIndex === flatIndex;
          return html`
            <button
              class=${classMap({
                'hover-popup-item': true,
                'hover-popup-item--active': isActive,
              })}
              @click=${() => {
                this.selectEditor(plugin, flatIndex, fromPinnedPopup);
                this.hoveredGroupName = null;
                this.hoveredRect = null;
              }}
            >
              ${plugin.icon
                ? html`<oscd-icon class="hover-popup-item-icon"
                    >${plugin.icon}</oscd-icon
                  >`
                : html`<span class="hover-popup-letter-icon"
                    >${(plugin.name || '?')[0].toUpperCase()}</span
                  >`}
              <span class="hover-popup-item-label"
                >${this.pluginLabel(plugin)}</span
              >
            </button>
          `;
        })}
      </div>
    `;
  }

  render() {
    let flatIndex = 0;

    const items = this.editors.map(item => {
      if (isPluginGroup(item)) {
        const flatStart = flatIndex;
        flatIndex += (item as ResolvedPluginGroup).plugins.length;
        return this.renderGroup(item as ResolvedPluginGroup, flatStart);
      }
      const result = this.renderPluginItem(item as PluginEntry, flatIndex);
      flatIndex++;
      return result;
    });

    const filteredItems: TemplateResult[] = [];
    if (this.isSearching) {
      const q = this.searchQuery.trim().toLowerCase();
      let idx = 0;
      for (const item of this.editors) {
        if (isPluginGroup(item)) {
          const g = item as ResolvedPluginGroup;
          const groupMatches = EditorPluginsPanel.matchesSearch(
            this.pluginLabel(g),
            q,
          );
          const flatStart = idx;
          if (groupMatches) {
            filteredItems.push(this.renderGroup(g, flatStart));
          } else {
            const matchingPlugins = g.plugins.filter(p =>
              EditorPluginsPanel.matchesSearch(this.pluginLabel(p), q),
            );
            if (matchingPlugins.length > 0) {
              filteredItems.push(this.renderGroup(g, flatStart, q));
            }
          }
          idx += g.plugins.length;
        } else {
          const p = item as PluginEntry;
          if (EditorPluginsPanel.matchesSearch(this.pluginLabel(p), q)) {
            filteredItems.push(this.renderPluginItem(p, idx));
          }
          idx++;
        }
      }
    }

    const pinnedPlugins = this.pinnedPluginsList;

    return html`
      ${this.expanded
        ? html`
            <div class="panel-toolbar">
              <div class="search-row">
                <span class="shortcut-badge-container"
                  ><oscd-icon class="search-icon">search</oscd-icon>${this
                    .showShortcuts && this.activeShortcutGroup === null
                    ? EditorPluginsPanel.renderShortcutBadge('F')
                    : nothing}</span
                >
                <input
                  ${ref(this.searchInputRef)}
                  class="search-input"
                  type="text"
                  placeholder=${msg('Search plugins…')}
                  .value=${this.searchQuery}
                  @input=${(e: InputEvent) => {
                    this.searchQuery = (e.target as HTMLInputElement).value;
                    this.focusedItem = null;
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Escape') {
                      this.searchQuery = '';
                      this.focusedItem = null;
                      this.collapseAfterSearchIfNeeded();
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      this.navigatePlugins(e.key);
                    } else if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (this.focusedItem !== null) {
                        this.confirmFocusedItem();
                      } else if (this.isSearching) {
                        const items = this.visibleNavigableItems;
                        if (items.length === 1) {
                          const item = items[0];
                          if (item.kind === 'plugin') {
                            this.selectEditor(
                              item.plugin,
                              item.flatIndex,
                              false,
                            );
                          }
                        } else if (items.length > 1) {
                          this.focusedItem = items[0];
                          this.scrollFocusedIntoView();
                        }
                      }
                    }
                  }}
                />
                ${this.isSearching
                  ? html`<button
                      class="search-clear"
                      title=${msg('Clear search')}
                      @click=${() => this.clearSearch()}
                    >
                      <oscd-icon>close</oscd-icon>
                    </button>`
                  : nothing}
              </div>
              ${this.hasGroups
                ? html`
                    <button
                      class="collapse-all-btn"
                      title=${this.allSectionsCollapsed
                        ? msg('Expand all')
                        : msg('Collapse all')}
                      @click=${() => this.toggleAllGroups()}
                    >
                      <oscd-icon class="collapse-all-icon"
                        >${this.allSectionsCollapsed
                          ? 'unfold_more'
                          : 'unfold_less'}</oscd-icon
                      >
                    </button>
                  `
                : nothing}
            </div>
          `
        : nothing}
      <div
        class="editors-list"
        role="tablist"
        tabindex="0"
        ${ref(this.editorsListRef)}
        @keydown=${(e: KeyboardEvent) => this.handleEditorListKeyDown(e)}
      >
        ${pinnedPlugins.length > 0 && !this.isSearching
          ? this.renderPinnedGroup(pinnedPlugins)
          : nothing}
        ${this.isSearching ? filteredItems : items}
      </div>
      <div class="list-end-spacer"></div>
      <div class="footer">
        <oscd-icon-button
          class="toggle-button"
          title=${!this.expanded ? msg('Expand sidebar') : ''}
          @click=${() => this.toggleExpanded()}
        >
          <oscd-icon
            >${this.expanded
              ? 'left_panel_close'
              : 'left_panel_open'}</oscd-icon
          >
        </oscd-icon-button>
        ${this.expanded
          ? html`<span
              class="toggle-sidebar"
              role="button"
              tabindex="0"
              @click=${() => this.toggleExpanded()}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  this.toggleExpanded();
                }
              }}
              >${msg('Collapse sidebar')}</span
            >`
          : nothing}
      </div>
      ${this.renderHoverPopup()}
    `;
  }

  static styles = css`
    :host {
      width: var(--editor-plugins-panel-collapsed-width);
      height: calc(100% - var(--editor-plugins-panel-padding-top));
      display: flex;
      flex-direction: column;
      padding-top: var(--editor-plugins-panel-padding-top);
      transition: width 0.2s ease-in-out;
      /* overlay scrollbar floats above content — no layout shift on appear/disappear */
      overflow-y: overlay;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: color-mix(
          in srgb,
          var(--editor-plugins-panel-item-icon-color) 15%,
          transparent
        )
        transparent;
    }

    :host([expanded]) {
      width: var(--editor-plugins-panel-width);
    }

    :host::-webkit-scrollbar {
      width: 4px;
    }

    :host::-webkit-scrollbar-track {
      background: transparent;
    }

    :host::-webkit-scrollbar-thumb {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 15%,
        transparent
      );
      border-radius: 2px;
    }

    :host:hover::-webkit-scrollbar-thumb {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 45%,
        transparent
      );
    }

    /* ── Toolbar ── */

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px 4px;
      flex-shrink: 0;
    }

    :host(:not([expanded])) .toolbar {
      justify-content: center;
      padding-left: 0;
      padding-right: 0;
    }

    .sidebar-pin-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      border-radius: 50%;
      border: 1.5px solid
        color-mix(
          in srgb,
          var(--editor-plugins-panel-item-icon-color) 40%,
          transparent
        );
      background: transparent;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 55%,
        transparent
      );
      cursor: pointer;
      padding: 0;
      transition:
        border-color 0.15s ease,
        background-color 0.15s ease,
        color 0.15s ease;
      --md-icon-size: 15px;
      --md-icon-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 55%,
        transparent
      );
    }

    .sidebar-pin-btn:hover {
      border-color: var(--editor-plugins-panel-item-icon-color);
      color: var(--editor-plugins-panel-item-icon-color);
      --md-icon-color: var(--editor-plugins-panel-item-icon-color);
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 12%,
        transparent
      );
    }

    .sidebar-pin-btn--active {
      border-color: var(--editor-plugins-panel-group-active-bg);
      color: var(--editor-plugins-panel-group-active-bg);
      --md-icon-color: var(--editor-plugins-panel-group-active-bg);
    }

    .sidebar-pin-btn--active:hover {
      border-color: var(--editor-plugins-panel-group-active-bg);
      color: var(--editor-plugins-panel-group-active-bg);
      --md-icon-color: var(--editor-plugins-panel-group-active-bg);
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-group-active-bg) 12%,
        transparent
      );
    }

    .toolbar-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--oscd-text-font, Roboto);
      font-size: 13px;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-text-color) 70%,
        transparent
      );
    }

    /* ── Plugin list container ── */

    .editors-list {
      flex: 1 0 auto;
      width: 100%;
      box-sizing: border-box;
    }

    /* ── Individual plugin items ── */

    .plugin-item {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 6px var(--editor-plugins-panel-item-trailing-space) 6px
        var(--editor-plugins-panel-item-leading-space);
      cursor: pointer;
      color: var(--editor-plugins-panel-item-text-color);
      border-radius: 4px;
      box-sizing: border-box;
      width: 100%;
      outline: none;
      transition: background-color 0.12s ease;
    }

    :host(:not([expanded])) .plugin-item {
      justify-content: center;
      padding-left: 0;
      padding-right: 0;
    }

    .plugin-item:hover {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 10%,
        transparent
      );
    }

    .plugin-item:focus-visible {
      outline: 2px solid var(--editor-plugins-panel-item-icon-color);
      outline-offset: -2px;
    }

    .plugin-item--active {
      background-color: var(--editor-plugins-panel-item-active-bg);
    }

    .plugin-item--active:hover {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-active-bg) 85%,
        white
      );
    }

    .plugin-item--focused {
      outline: 2px solid var(--editor-plugins-panel-item-icon-color);
      outline-offset: -2px;
    }

    /* Indent children in expanded groups */
    :host([expanded]) .plugin-item--in-group {
      padding-left: calc(var(--editor-plugins-panel-item-leading-space) + 14px);
    }

    .plugin-item--shortcut-target {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 18%,
        transparent
      );
    }

    /* Active item inside a group container: subtle overlay */
    .group-container .plugin-item--active {
      background-color: color-mix(in srgb, white 22%, transparent);
      border-radius: 7px;
      margin: 0 3px;
    }

    :host(:not([expanded])) .group-container .plugin-item--active {
      margin: 0;
      border-radius: 4px;
    }

    /* ── Item icon ── */

    .item-icon {
      --md-icon-size: var(--editor-plugins-panel-item-icon-size);
      color: var(--editor-plugins-panel-item-icon-color);
      flex-shrink: 0;
    }

    /* ── Plugin letter icon fallback ── */

    .plugin-letter-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--editor-plugins-panel-item-icon-size);
      height: var(--editor-plugins-panel-item-icon-size);
      border-radius: 5px;
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 30%,
        transparent
      );
      color: var(--editor-plugins-panel-item-icon-color);
      font-size: calc(var(--editor-plugins-panel-item-icon-size) * 0.55);
      font-weight: 600;
      font-family: var(--oscd-text-font, Roboto);
      flex-shrink: 0;
    }

    /* ── Plugin item label ── */

    .plugin-item-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--oscd-text-font, Roboto);
      font-size: 16px;
    }

    /* ── Per-plugin pin button ── */

    .plugin-pin-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border: none;
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      padding: 0;
      opacity: 0;
      transition:
        opacity 0.15s ease,
        background-color 0.15s ease;
      --md-icon-size: 14px;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 60%,
        transparent
      );
      --md-icon-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 60%,
        transparent
      );
    }

    .plugin-item:hover .plugin-pin-btn,
    .plugin-pin-btn--active {
      opacity: 1;
    }

    .plugin-pin-btn:hover {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 15%,
        transparent
      );
      color: var(--editor-plugins-panel-item-icon-color);
      --md-icon-color: var(--editor-plugins-panel-item-icon-color);
    }

    .plugin-pin-btn--active {
      color: var(--editor-plugins-panel-group-active-bg);
      --md-icon-color: var(--editor-plugins-panel-group-active-bg);
    }

    oscd-icon[filled] {
      font-variation-settings: 'FILL' 1;
    }

    /* ── Group container ── */

    .group-container {
      margin: 3px 6px;
      border-radius: 10px;
      overflow-x: hidden;
      background: color-mix(
        in srgb,
        var(--editor-plugins-panel-group-active-bg) 55%,
        transparent
      );
      transition:
        margin 0.2s ease,
        background 0.2s ease;
    }

    .group-container--inactive {
      margin: 1px 6px;
      background: color-mix(
        in srgb,
        var(--editor-plugins-panel-group-active-bg) 28%,
        transparent
      );
    }

    .group-container--collapsed {
      margin: 1px 6px;
    }

    .group-container--collapsed .group-header {
      border-radius: 8px;
    }

    .group-container--collapsed-active {
      margin: 1px 4px;
      background: color-mix(
        in srgb,
        var(--editor-plugins-panel-group-active-bg) 55%,
        transparent
      );
      border-radius: 10px;
      overflow-x: hidden;
    }

    /* Highlight the group container when its hover popup is open */
    .group-container--hovered {
      background: color-mix(
        in srgb,
        var(--editor-plugins-panel-group-active-bg) 50%,
        transparent
      );
    }

    :host(:not([expanded])) .group-container {
      margin: 1px 4px;
    }

    /* ── Group header (expanded sidebar) ── */

    .group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 10px var(--editor-plugins-panel-item-trailing-space) 10px
        var(--editor-plugins-panel-item-leading-space);
      border-radius: 8px 8px 0 0;
      color: var(--editor-plugins-panel-item-text-color);
    }

    .group-header .group-header-icon {
      --md-icon-size: var(--editor-plugins-panel-item-icon-size);
      color: var(--editor-plugins-panel-item-icon-color);
      flex-shrink: 0;
    }

    .shortcut-badge-container {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .shortcut-badge {
      position: absolute;
      top: -4px;
      right: -6px;
      min-width: 14px;
      height: 14px;
      line-height: 14px;
      padding: 0 3px;
      border-radius: 4px;
      background-color: var(--oscd-secondary, #2485e5);
      color: var(--oscd-base3, #fff);
      font-family: var(--oscd-text-font, Roboto);
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      z-index: 2;
      pointer-events: none;
    }

    .group-active {
      background-color: var(--editor-plugins-panel-group-active-bg);
    }

    .group-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--oscd-text-font, Roboto);
      font-size: var(--md-list-item-label-text-size, 16px);
    }

    .group-header--clickable {
      cursor: pointer;
      border-radius: 8px;
      transition: background-color 0.12s ease;
    }

    .group-header--clickable:hover {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 8%,
        transparent
      );
    }

    .group-header--focused {
      outline: 2px solid var(--editor-plugins-panel-item-icon-color);
      outline-offset: -2px;
    }

    .group-collapse-chevron {
      --md-icon-size: 20px;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 55%,
        transparent
      );
      flex-shrink: 0;
      margin-left: auto;
    }

    /* ── Panel toolbar (search + collapse-all) ── */

    .panel-toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
      flex-shrink: 0;
      margin-top: calc(var(--editor-plugins-panel-padding-top) * -0.6);
    }

    .search-row {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 8px;
      background: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 10%,
        transparent
      );
    }

    .search-icon {
      --md-icon-size: 18px;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 50%,
        transparent
      );
      flex-shrink: 0;
    }

    .search-input {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      background: transparent;
      color: var(--editor-plugins-panel-item-text-color);
      font-family: var(--oscd-text-font, Roboto);
      font-size: 14px;
      padding: 2px 0;
    }

    .search-input::placeholder {
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 40%,
        transparent
      );
    }

    .search-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 55%,
        transparent
      );
      --md-icon-size: 16px;
      transition:
        background-color 0.12s ease,
        color 0.12s ease;
    }

    .search-clear:hover {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 15%,
        transparent
      );
      color: var(--editor-plugins-panel-item-icon-color);
    }

    .collapse-all-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 50%,
        transparent
      );
      --md-icon-size: 18px;
      transition:
        background-color 0.12s ease,
        color 0.12s ease;
    }

    .collapse-all-btn:hover {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 10%,
        transparent
      );
      color: var(--editor-plugins-panel-item-icon-color);
    }

    .collapse-all-icon {
      --md-icon-size: 18px;
      color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 50%,
        transparent
      );
    }

    .collapse-all-btn:hover .collapse-all-icon {
      color: var(--editor-plugins-panel-item-icon-color);
    }

    /* ── Group header (collapsed sidebar) ── */

    .group-header-narrow {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 7px 0;
      color: var(--editor-plugins-panel-item-icon-color);
    }

    .group-header-narrow .group-header-icon {
      --md-icon-size: var(--editor-plugins-panel-item-icon-size);
    }

    .group-header-narrow.group-active {
      background-color: var(--editor-plugins-panel-group-active-bg);
      color: var(--editor-plugins-panel-item-icon-color);
    }

    /* ── Hover popup ── */

    .hover-popup {
      position: fixed;
      z-index: 1000;
      min-width: 220px;
      max-width: 320px;
      border-radius: 10px;
      overflow: hidden;
      background-color: var(
        --oscd-shell-editor-plugins-panel-background,
        var(--oscd-primary)
      );
      box-shadow:
        0 4px 16px rgba(0, 0, 0, 0.35),
        0 1px 4px rgba(0, 0, 0, 0.2);
      animation: popup-enter 0.15s ease;
    }

    @keyframes popup-enter {
      from {
        opacity: 0;
        transform: translateX(-6px);
      }

      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .hover-popup-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background-color: var(--editor-plugins-panel-group-active-bg);
      color: var(--editor-plugins-panel-item-text-color);
    }

    .hover-popup-group-icon {
      --md-icon-size: var(--editor-plugins-panel-item-icon-size);
      color: var(--editor-plugins-panel-item-icon-color);
      flex-shrink: 0;
    }

    .hover-popup-group-name {
      font-family: var(--oscd-text-font, Roboto);
      font-size: 15px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--editor-plugins-panel-item-text-color);
    }

    .hover-popup-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-height: 40px;
      padding: 6px 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      text-align: left;
      color: var(--editor-plugins-panel-item-text-color);
      transition: background-color 0.1s ease;
      box-sizing: border-box;
    }

    .hover-popup-item:hover {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 12%,
        transparent
      );
    }

    .hover-popup-item--active {
      background-color: color-mix(in srgb, white 18%, transparent);
    }

    .hover-popup-item--active:hover {
      background-color: color-mix(in srgb, white 26%, transparent);
    }

    .hover-popup-item-icon {
      --md-icon-size: var(--editor-plugins-panel-item-icon-size);
      color: var(--editor-plugins-panel-item-icon-color);
      flex-shrink: 0;
    }

    .hover-popup-letter-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--editor-plugins-panel-item-icon-size);
      height: var(--editor-plugins-panel-item-icon-size);
      flex-shrink: 0;
      border-radius: 5px;
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 30%,
        transparent
      );
      color: var(--editor-plugins-panel-item-icon-color);
      font-size: calc(var(--editor-plugins-panel-item-icon-size) * 0.55);
      font-weight: 600;
      font-family: var(--oscd-text-font, Roboto);
    }

    .hover-popup-item-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--oscd-text-font, Roboto);
      font-size: 15px;
    }

    /* ── Spacer between list and footer ── */

    .list-end-spacer {
      min-height: 60px;
      flex-shrink: 0;
    }

    /* ── Footer — always at bottom, above all content ── */

    .footer {
      position: sticky;
      bottom: 0;
      /* margin-top: auto pushes footer to bottom when content is short */
      margin-top: auto;
      display: flex;
      align-items: center;
      min-height: 56px;
      flex-shrink: 0;
      padding-left: calc(var(--editor-plugins-panel-item-leading-space) - 6px);
      background-color: var(
        --oscd-shell-editor-plugins-panel-background,
        var(--oscd-primary)
      );
      /* Own stacking context above all list-item hover/focus states */
      isolation: isolate;
      z-index: 10;
    }

    .footer:focus,
    .footer:hover,
    .footer:active {
      background-color: color-mix(
        in srgb,
        var(--editor-plugins-panel-item-icon-color) 8%,
        var(--oscd-shell-editor-plugins-panel-background)
      );
    }

    .toggle-button {
      --md-icon-button-icon-size: var(--editor-plugins-panel-item-icon-size);
      --md-icon-button-icon-color: var(--editor-plugins-panel-item-icon-color);
      --md-icon-button-hover-icon-color: var(
        --editor-plugins-panel-item-icon-color
      );
      --md-icon-button-focus-icon-color: var(
        --editor-plugins-panel-item-icon-color
      );
      --md-icon-button-pressed-icon-color: var(
        --editor-plugins-panel-item-icon-color
      );
    }

    .group-divider {
      border-top: 1px solid
        color-mix(
          in srgb,
          var(--editor-plugins-panel-item-icon-color) 12%,
          transparent
        );
    }

    .toggle-sidebar {
      margin-left: 12px;
      height: 100%;
      width: 100%;
      align-content: center;
      cursor: pointer;
      color: var(--editor-plugins-panel-item-text-color);
      font-family: var(--oscd-text-font, Roboto);
      font-size: var(--md-list-item-label-text-size, 16px);
      white-space: nowrap;
    }
  `;
}
