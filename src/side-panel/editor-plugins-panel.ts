import { css, html, LitElement, nothing, TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ScopedElementsMixin } from '@open-wc/scoped-elements/lit-element.js';
import { localized, msg } from '@lit/localize';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { styleMap } from 'lit/directives/style-map.js';

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
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
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
    opts: { inGroup?: boolean; inPinnedGroup?: boolean } = {},
  ): TemplateResult {
    // Plugin item is highlighted wherever it appears when active
    const isActive = this.editorIndex === flatIndex;
    const tooltip = !this.expanded ? this.pluginLabel(plugin) : undefined;
    const isPinned = this.pinnedPluginKeys.has(this.pluginKey(plugin));
    return html`
      <div
        class=${classMap({
          'plugin-item': true,
          'plugin-item--active': isActive,
          'plugin-item--in-group': !!opts.inGroup,
        })}
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
        ${this.renderPluginIcon(plugin)}
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

    if (this.expanded) {
      return html`
        <div
          class=${classMap({
            'group-container': true,
            'group-container--inactive': !hasActiveChild,
          })}
        >
          <div
            class=${classMap({
              'group-header': true,
              'group-active': hasActiveChild,
            })}
          >
            <oscd-icon class="group-header-icon">push_pin</oscd-icon>
            <span class="group-name">${msg('Pinned')}</span>
          </div>
          <div class="group-divider"></div>
          ${flatPlugins.map(({ plugin, flatIndex }) =>
            this.renderPluginItem(plugin, flatIndex, {
              inGroup: true,
              inPinnedGroup: true,
            }),
          )}
        </div>
      `;
    }

    const isHovered = this.hoveredGroupName === PINNED_GROUP_KEY;
    return html`
      <div
        class=${classMap({
          'group-container': true,
          'group-container--inactive': !hasActiveChild,
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
          <oscd-icon class="group-header-icon">push_pin</oscd-icon>
        </div>
      </div>
    `;
  }

  private renderGroup(
    group: ResolvedPluginGroup,
    flatStart: number,
  ): TemplateResult {
    const label = this.pluginLabel(group);
    // Only highlight this group when the user selected from within it (not from the pinned group)
    const hasActiveChild =
      !this.activeFromPinned &&
      group.plugins.some((_, i) => flatStart + i === this.editorIndex);

    if (this.expanded) {
      return html`
        <div
          class=${classMap({
            'group-container': true,
            'group-container--inactive': !hasActiveChild,
          })}
        >
          <div
            class=${classMap({
              'group-header': true,
              'group-active': hasActiveChild,
            })}
          >
            <oscd-icon class="group-header-icon">${group.icon}</oscd-icon>
            <span class="group-name">${label}</span>
          </div>
          <div class="group-divider"></div>
          ${group.plugins.map((plugin, i) =>
            this.renderPluginItem(plugin, flatStart + i, { inGroup: true }),
          )}
        </div>
      `;
    }

    // Collapsed: group icon only. Hover → popup. Click → expand sidebar.
    const isHovered = this.hoveredGroupName === group.name;
    return html`
      <div
        class=${classMap({
          'group-container': true,
          'group-container--inactive': !hasActiveChild,
          'group-container--hovered': isHovered,
        })}
        role="button"
        tabindex="0"
        title=${label}
        @mouseenter=${(e: MouseEvent) =>
          this.showPopup(group.name, e.currentTarget as Element)}
        @mouseleave=${() => this.scheduleHidePopup()}
        @click=${() => {
          this.expanded = true;
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            this.expanded = true;
          }
        }}
      >
        <div
          class=${classMap({
            'group-header-narrow': true,
            'group-active': hasActiveChild,
          })}
        >
          <oscd-icon class="group-header-icon">${group.icon}</oscd-icon>
        </div>
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

    const pinnedPlugins = this.pinnedPluginsList;

    return html`
      <div class="editors-list" role="tablist">
        ${pinnedPlugins.length > 0
          ? this.renderPinnedGroup(pinnedPlugins)
          : nothing}
        ${items}
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

    /* Indent children in expanded groups */
    :host([expanded]) .plugin-item--in-group {
      padding-left: calc(var(--editor-plugins-panel-item-leading-space) + 14px);
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
