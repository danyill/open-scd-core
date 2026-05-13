// Known issue, scoped registry polyfill doesn't load as fast as oscd-shell, causing oscs-shell to fail.
      // To safeguard, we await the polyfill first, then load the rest.
      await import('./scoped-custom-element-registry.min-rSxJSIou.js');
      await import('./oscd-shell-XjSTTv8y.js');
      await import('./index-BXsTQYSS.js');

      const _customElementsDefine = window.customElements.define;
      window.customElements.define = (name, cl, conf) => {
        if (!customElements.get(name)) {
          try {
            _customElementsDefine.call(window.customElements, name, cl, conf);
          } catch (e) {
            console.warn(e);
          }
        }
      };
//# sourceMappingURL=inline-module-4c04f69ca8ea49e8468a549b7d8d2c1f.js.map
