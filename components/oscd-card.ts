import { css, html, LitElement } from 'lit';

import { customElement, property } from 'lit/decorators.js';

@customElement('oscd-card')
export class Card extends LitElement {
  @property({ type: Number }) stackLevel = 0;

  render() {
    const scale = `${1 - this.stackLevel * 0.05}`;
    const translateY = `${-this.stackLevel * 40}px`;
    const translateX = `0px`;

    const style = `
        --scale: ${scale};
        --translate-x: ${translateX};
        --translate-y: ${translateY};
      `;

    return html`
      <div class="container" style=${style}>
        <div class="surface">
          <div class="content">
            <slot></slot>
          </div>
        </div>
      </div>
    `;
  }

  static styles = css`
    :host {
      position: fixed;
      top: 0px;
      left: 0px;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
    }

    .container {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-around;
      box-sizing: border-box;
      height: 100%;
      pointer-events: none;
      transform: scale(var(--scale))
        translate(var(--translate-x), var(--translate-y));
      transition: all 0.5s ease-in-out;
    }

    .surface {
      max-height: var(--mdc-dialog-max-height, calc(100% - 32px));
      min-width: var(--mdc-dialog-min-width, 280px);
      border-radius: var(--mdc-shape-medium, 4px);
      background-color: var(--mdc-theme-surface, #fff);
      box-shadow: var(
        --mdc-dialog-box-shadow,
        0px 11px 15px -7px rgba(0, 0, 0, 0.2),
        0px 24px 38px 3px rgba(0, 0, 0, 0.14),
        0px 9px 46px 8px rgba(0, 0, 0, 0.12)
      );
      position: relative;
      display: flex;
      flex-direction: column;
      flex-grow: 0;
      flex-shrink: 0;
      box-sizing: border-box;
      max-width: 100%;
      max-height: 100%;
      pointer-events: auto;
      overflow-y: auto;
    }
  `;
}
